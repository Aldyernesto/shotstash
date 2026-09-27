"use client";

/**
 * Story 3.23 — Halaman Trash: Restore, Delete Forever, dan `remaining-chip`.
 *
 * Lapisan bersama yang DIPAKAI APA ADANYA:
 *   `confirm-dialog` → Story 3.1 (dialog desktop / confirm-sheet HP)
 *   `toast`          → Story 3.2 (`useToast` + `humanizeError`)
 *   `button-danger`  → Story 1.14
 *   `status-chip`    → Story 1.15 (dasar `remaining-chip`)
 *   `status-mark`    → Story 1.27 (layar tanpa izin)
 *   `rep-thumb`      → Story 2.14 (placeholder; thumbnail baris = FR40/Epic 4)
 *   `empty-state` / `skeleton-row` / `error-box` → Story 2.8 + 3.2
 *
 * `ConfirmModal` warisan TIDAK lagi dipakai di jalur ini.
 */

import React, { useMemo, useState } from "react";
import { useQuery, useMutation, gql } from "@apollo/client";
import Link from "next/link";
import styles from "./page.module.css";
import { useAuth } from "@/components/AuthContext";
import { canPurgeTrash, canViewTrash } from "@/lib/permissions";
import RepThumb from "@/components/dashboard/RepThumb";
import StatusMark from "@/components/auth/StatusMark";
import { ConfirmDialog } from "@/components/overlay/Dialog";
import { useToast, humanizeError } from "@/components/feedback/ToastProvider";
import { ButtonDanger, PillButton } from "@/components/form/buttons";
import { EmptyState, SkeletonRow, ErrorBox } from "@/components/dashboard/states";
import TagPill from "@/components/tag-pill/TagPill";
import { parseSectionName } from "@/lib/sectionNumber";
import { formatFileSize, formatCount, formatNumber } from "@/lib/format";

const GET_ALL_TRASHED = gql`
  query GetAllTrashed {
    allTrashedFiles {
      id
      originalName
      mimeType
      size
      trashedAt
    }
    allTrashedFolders {
      id
      name
      trashedAt
      project {
        id
        title
      }
    }
  }
`;

const RESTORE_FILE = gql`
  mutation RestoreFile($fileId: ID!) {
    restoreFile(fileId: $fileId) {
      id
      originalName
    }
  }
`;

const PERMANENT_DELETE = gql`
  mutation PermanentDelete($fileId: ID!) {
    permanentDelete(fileId: $fileId)
  }
`;

const RESTORE_FOLDER = gql`
  mutation RestoreFolder($folderId: ID!) {
    restoreFolder(folderId: $folderId) {
      id
      name
    }
  }
`;

const PERMANENT_DELETE_FOLDER = gql`
  mutation PermanentDeleteFolder($folderId: ID!) {
    permanentDeleteFolder(folderId: $folderId)
  }
`;

/** Retensi Trash — satu tempat, dipakai chip dan kalimat kosong. */
const RETENTION_DAYS = 30;
/** Ambang "hampir habis": chip berubah tint danger + ikon peringatan. */
const URGENT_DAYS = 3;

const ICON_CLOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
);
const ICON_WARN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4.5l8.5 15h-17z" />
    <path d="M12 10v4.2M12 17.2v.2" />
  </svg>
);
const ICON_SEARCH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
const ICON_RESTORE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 10.5a7.6 7.6 0 1 1 .6 5.2" />
    <path d="M4 5.5v5h5" />
  </svg>
);
const ICON_TRASH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 7h15M9.5 7V4.8h5V7M6.8 7l.8 12.2h8.8L17.2 7" />
  </svg>
);

const SORT_FIELDS = [
  { field: "date" as const, label: "Tanggal" },
  { field: "name" as const, label: "Nama" },
  { field: "size" as const, label: "Ukuran" },
];

type SortField = (typeof SORT_FIELDS)[number]["field"];

type TrashedFile = {
  id: string;
  originalName: string;
  mimeType?: string | null;
  size: string | number;
  trashedAt?: string | null;
};

type TrashedFolder = {
  id: string;
  name: string;
  trashedAt?: string | null;
  project?: { id: string; title: string } | null;
};

/**
 * Placeholder `rep-thumb`: bentuk benar per tingkat, isi
 * `{colors.rep-placeholder}`. Data thumbnail baris = FR40/Epic 4.
 */
const REP_PLACEHOLDER = [
  { id: "ph-1", kind: "image" },
  { id: "ph-2", kind: "image" },
  { id: "ph-3", kind: "image" },
];

/**
 * Sisa hari retensi; 0 bila sudah lewat. Dibatasi di RETENTION_DAYS juga
 * di atas: data dengan `trashedAt` di masa depan (seed / jam server geser)
 * tidak boleh menulis "33 hari lagi" pada retensi 30 hari.
 */
function daysLeft(trashedAt?: string | null): number | null {
  if (!trashedAt) return null;
  const expires = new Date(trashedAt).getTime() + RETENTION_DAYS * 86400000;
  const left = Math.ceil((expires - Date.now()) / 86400000);
  return Math.min(RETENTION_DAYS, Math.max(0, left));
}

function fileKind(mimeType?: string | null): string {
  const m = (mimeType || "").toLowerCase();
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  return "document";
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

type PendingAction = {
  kind: "restore" | "delete";
  target: "file" | "section";
  id: string;
  name: string;
  meta: string;
  thumb: React.ReactNode;
};

export default function TrashPage() {
  const { user } = useAuth();
  const allowed = canViewTrash(user);
  // Story 2.4: only super admin and admin purge; the button is not rendered otherwise.
  const canPurge = canPurgeTrash(user);

  const { data, loading, error, refetch } = useQuery(GET_ALL_TRASHED, {
    fetchPolicy: "cache-and-network",
    skip: !allowed,
  });
  const { pushToast } = useToast();

  const [restoreFile] = useMutation(RESTORE_FILE);
  const [permanentDelete] = useMutation(PERMANENT_DELETE);
  const [restoreFolder] = useMutation(RESTORE_FOLDER);
  const [permanentDeleteFolder] = useMutation(PERMANENT_DELETE_FOLDER);

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("date");
  const [announce, setAnnounce] = useState("");

  const q = query.trim().toLowerCase();

  const files: TrashedFile[] = useMemo(() => {
    const raw: TrashedFile[] = data?.allTrashedFiles ?? [];
    return raw
      .filter((f) => !q || f.originalName.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (sortBy === "name") return a.originalName.localeCompare(b.originalName, "id");
        if (sortBy === "size") return Number(b.size) - Number(a.size);
        return new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime();
      });
  }, [data, q, sortBy]);

  const folders: TrashedFolder[] = useMemo(() => {
    const raw: TrashedFolder[] = data?.allTrashedFolders ?? [];
    return raw
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name, "id");
        return new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime();
      });
  }, [data, q, sortBy]);

  /* Layar tanpa izin — hanya tercapai lewat URL langsung; menu Trash
     memang tidak dirender untuk role lain. */
  if (!allowed) {
    return (
      <div className={styles.denyWrap}>
        <StatusMark variant="locked" />
        <h1 className={`${styles.denyTitle} spine-display-title`}>Akses ditolak</h1>
        <p className={`${styles.denyText} spine-body-lead`}>
          Hanya admin yang bisa membuka Trash.
        </p>
        <Link href="/dashboard" className={`${styles.denyLink} spine-button spine-focus-ring`}>
          ← My Media
        </Link>
      </div>
    );
  }

  const total = files.length + folders.length;
  const rawTotal =
    (data?.allTrashedFiles?.length ?? 0) + (data?.allTrashedFolders?.length ?? 0);

  const runAction = async () => {
    if (!pending) return;
    const p = pending;
    setBusy(true);
    try {
      if (p.kind === "restore" && p.target === "file") {
        await restoreFile({ variables: { fileId: p.id } });
      } else if (p.kind === "restore") {
        await restoreFolder({ variables: { folderId: p.id } });
      } else if (p.target === "file") {
        await permanentDelete({ variables: { fileId: p.id } });
      } else {
        await permanentDeleteFolder({ variables: { folderId: p.id } });
      }
      await refetch();
      setPending(null);
      setAnnounce(
        p.kind === "restore"
          ? `${p.name} dikembalikan dari Trash.`
          : `${p.name} dihapus permanen.`,
      );
      pushToast({
        tone: "success",
        message: p.kind === "restore" ? "Berhasil dikembalikan." : "Dihapus permanen.",
      });
    } catch (err) {
      console.error("Aksi Trash gagal", err);
      setPending(null);
      pushToast({
        tone: "error",
        message:
          p.kind === "restore"
            ? "Gagal mengembalikan. Coba lagi."
            : "Gagal menghapus permanen. Coba lagi.",
        cause: humanizeError(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmTitle = !pending
    ? ""
    : pending.kind === "restore"
      ? pending.target === "file"
        ? "Restore file ini?"
        : "Restore Section ini?"
      : "Hapus permanen?";

  const confirmLead = !pending
    ? null
    : pending.kind === "restore"
      ? pending.target === "file"
        ? "File akan dikembalikan dari Trash."
        : "Section akan dikembalikan dari Trash."
      : pending.target === "file"
        ? `Hapus permanen "${pending.name}"? Tindakan ini tidak bisa dibatalkan.`
        : `Section "${pending.name}" beserta SEMUA file di dalamnya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.`;

  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <Link href="/dashboard" className={`${styles.backPill} spine-hit-area spine-focus-ring spine-link`}>
          ← My Media
        </Link>
        <h1 className={`${styles.pageTitle} spine-display-page`}>
          <span className={styles.pageTitleText}>Trash</span>
          {rawTotal > 0 ? <TagPill>{formatCount(rawTotal, "item")}</TagPill> : null}
        </h1>
        <p className={`${styles.pageSub} spine-body-sub`}>
          Item di Trash <b>terhapus otomatis setelah {RETENTION_DAYS} hari</b>. Restore untuk
          mengembalikannya.
        </p>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchPill}>
          <span className={styles.searchIcon} aria-hidden="true">
            {ICON_SEARCH}
          </span>
          <input
            type="search"
            className={`${styles.searchInput} spine-body`}
            placeholder="Cari file &amp; Section di Trash…"
            aria-label="Cari file &amp; Section di Trash…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className={styles.sortPills} role="group" aria-label="Urutkan">
          {SORT_FIELDS.map(({ field, label }) => (
            <button
              key={field}
              type="button"
              aria-pressed={sortBy === field}
              className={`${styles.sortPill} ${sortBy === field ? styles.sortPillActive : ""} spine-sort spine-focus-ring`}
              onClick={() => setSortBy(field)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="spine-visually-hidden" role="status">
        {announce}
      </p>
      {/* Hasil pencarian diumumkan polite, terpisah dari hasil aksi. */}
      <p className="spine-visually-hidden" role="status">
        {q ? `${formatNumber(total)} hasil untuk "${query.trim()}" di Trash.` : ""}
      </p>

      {loading && !data ? (
        <div className={styles.loadingBlock}>
          <p className={`${styles.loadingText} spine-body`}>Memuat…</p>
          <SkeletonRow rows={3} variant="card" />
        </div>
      ) : error ? (
        <ErrorBox
          title="Gagal memuat. Coba lagi."
          text="Isi Trash tidak bisa diambil dari server."
          onRetry={() => void refetch()}
        />
      ) : total === 0 ? (
        q ? (
          <EmptyState
            variant="none"
            title={`Tidak ada hasil untuk "${query.trim()}" di Trash.`}
            text="Coba kata lain, atau kosongkan kolom cari untuk melihat semua item."
          />
        ) : (
          <EmptyState
            variant="ghost"
            title="Trash kosong"
            text={`Section dan file yang dihapus tersimpan di sini selama ${RETENTION_DAYS} hari sebelum terhapus otomatis.`}
          />
        )
      ) : (
        <>
          {folders.length > 0 ? (
            <section className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className={`${styles.groupTitle} spine-display-panel-mobile`}>Section</h2>
                <span className={`${styles.countChip} spine-chip`}>
                  {formatNumber(folders.length)}
                </span>
              </div>
              <div className={styles.table} role="table" aria-label="Section di Trash">
                <div className={styles.headRow} role="row">
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    Nama
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    Project
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    Sisa waktu
                  </span>
                  <span role="columnheader" className="spine-visually-hidden">
                    Aksi
                  </span>
                </div>
                {folders.map((f) => {
                  const { number, title } = parseSectionName(f.name);
                  const left = daysLeft(f.trashedAt);
                  const thumb = <RepThumb variant="section" repFiles={REP_PLACEHOLDER} />;
                  return (
                    <div key={f.id} className={styles.row} role="row">
                      <div className={`${styles.cell} ${styles.cellContent}`} role="cell">
                        {thumb}
                        <span className={styles.titleLine}>
                          {number ? (
                            <span className={`spine-display-label ${styles.numberSticker}`}>
                              <span className={styles.numberPrefix} aria-hidden="true">
                                NO
                              </span>
                              <span className="spine-visually-hidden">Nomor</span> {number}
                            </span>
                          ) : null}
                          <b className={`${styles.rowName} spine-row-title`} title={title}>
                            {title}
                          </b>
                        </span>
                      </div>
                      <div className={`${styles.cell} ${styles.cellPlain} spine-body`} role="cell">
                        {f.project?.title || "—"}
                      </div>
                      <div className={styles.cell} role="cell">
                        <RemainingChip days={left} />
                      </div>
                      <div className={`${styles.cell} ${styles.cellAction}`} role="cell">
                        <PillButton
                          variant="surface"
                          className={styles.actionBtn}
                          onClick={() =>
                            setPending({
                              kind: "restore",
                              target: "section",
                              id: f.id,
                              name: title,
                              meta: `Section · Project ${f.project?.title || "—"} · ${remainingText(left)}`,
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_RESTORE}
                          </span>
                          Restore
                        </PillButton>
                        {canPurge ? (
                        <ButtonDanger
                          variant="outline"
                          className={styles.actionBtn}
                          onClick={() =>
                            setPending({
                              kind: "delete",
                              target: "section",
                              id: f.id,
                              name: title,
                              meta: `Section · Project ${f.project?.title || "—"} · ${remainingText(left)}`,
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_TRASH}
                          </span>
                          Delete Forever
                        </ButtonDanger>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {files.length > 0 ? (
            <section className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className={`${styles.groupTitle} spine-display-panel-mobile`}>File</h2>
                <span className={`${styles.countChip} spine-chip`}>
                  {formatNumber(files.length)}
                </span>
              </div>
              <div className={styles.table} role="table" aria-label="File di Trash">
                <div className={styles.headRow} role="row">
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    Nama
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    Ukuran
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    Sisa waktu
                  </span>
                  <span role="columnheader" className="spine-visually-hidden">
                    Aksi
                  </span>
                </div>
                {files.map((f) => {
                  const left = daysLeft(f.trashedAt);
                  const size = formatFileSize(Number(f.size));
                  const thumb = (
                    <RepThumb
                      variant="file"
                      file={{ kind: fileKind(f.mimeType), extension: fileExtension(f.originalName) }}
                    />
                  );
                  return (
                    <div key={f.id} className={styles.row} role="row">
                      <div className={`${styles.cell} ${styles.cellContent}`} role="cell">
                        {thumb}
                        <span className={styles.titleLine}>
                          <b className={`${styles.rowName} spine-row-title`} title={f.originalName}>
                            {f.originalName}
                          </b>
                        </span>
                      </div>
                      <div className={`${styles.cell} ${styles.cellPlain} spine-body`} role="cell">
                        {size}
                      </div>
                      <div className={styles.cell} role="cell">
                        <RemainingChip days={left} />
                      </div>
                      <div className={`${styles.cell} ${styles.cellAction}`} role="cell">
                        <PillButton
                          variant="surface"
                          className={styles.actionBtn}
                          onClick={() =>
                            setPending({
                              kind: "restore",
                              target: "file",
                              id: f.id,
                              name: f.originalName,
                              meta: `File · ${size} · ${remainingText(left)}`,
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_RESTORE}
                          </span>
                          Restore
                        </PillButton>
                        {canPurge ? (
                        <ButtonDanger
                          variant="outline"
                          className={styles.actionBtn}
                          onClick={() =>
                            setPending({
                              kind: "delete",
                              target: "file",
                              id: f.id,
                              name: f.originalName,
                              meta: `File · ${size} · ${remainingText(left)}`,
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_TRASH}
                          </span>
                          Delete Forever
                        </ButtonDanger>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}

      {pending ? (
        <ConfirmDialog
          title={confirmTitle}
          lead={confirmLead}
          /* Restore BUKAN tindakan berbahaya → tombol kuning; Delete
             Forever → `button-danger.solid` + `role="alertdialog"`. */
          tone={pending.kind === "restore" ? "recoverable" : "permanent"}
          /* Delete Forever = peringatan (`alertdialog`); Restore bukan —
             mock `key-trash.html` 05 merendernya sebagai `dialog` biasa. */
          alert={pending.kind !== "restore"}
          confirmLabel={pending.kind === "restore" ? "Restore" : "Delete Forever"}
          busyLabel={pending.kind === "restore" ? "Mengembalikan…" : "Menghapus…"}
          busy={busy}
          preview={{ thumb: pending.thumb, name: pending.name, meta: pending.meta }}
          onConfirm={() => void runAction()}
          onClose={() => (busy ? undefined : setPending(null))}
        />
      ) : null}
    </div>
  );
}

function remainingText(days: number | null): string {
  if (days === null) return "sisa waktu tidak diketahui";
  return `${formatNumber(days)} hari lagi`;
}

/**
 * `remaining-chip` — sisa retensi 30 hari. Pada ≤ 3 hari chip berubah
 * menjadi tint danger + ikon peringatan + teks tebal: arti TIDAK pernah
 * dibawa warna saja. Ikon `aria-hidden`; kalimatnya terbaca utuh.
 */
function RemainingChip({ days }: { days: number | null }) {
  const urgent = days !== null && days <= URGENT_DAYS;
  return (
    <span className={`${styles.remainingChip} ${urgent ? styles.remainingUrgent : ""}`}>
      <span className={styles.remainingIcon} aria-hidden="true">
        {urgent ? ICON_WARN : ICON_CLOCK}
      </span>
      <span className="spine-chip">{remainingText(days)}</span>
    </span>
  );
}
