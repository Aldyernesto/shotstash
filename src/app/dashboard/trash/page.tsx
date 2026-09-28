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
import { useTranslations } from "next-intl";
import { useToast, useHumanizeError } from "@/components/feedback/ToastProvider";
import { ButtonDanger, PillButton } from "@/components/form/buttons";
import { EmptyState, SkeletonRow, ErrorBox } from "@/components/dashboard/states";
import TagPill from "@/components/tag-pill/TagPill";
import { parseSectionName } from "@/lib/sectionNumber";
import { useFormat } from "@/i18n/useFormat";

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

const SORT_FIELDS = [{ field: "date" as const }, { field: "name" as const }, { field: "size" as const }];

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
  const t = useTranslations("trash");
  const tc = useTranslations("common");
  const f = useFormat();
  const humanize = useHumanizeError();
  const remainingText = (days: number | null) =>
    days === null ? t("remainingUnknown") : t("remainingDays", { count: days });

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
        if (sortBy === "name") return a.originalName.localeCompare(b.originalName, f.locale);
        if (sortBy === "size") return Number(b.size) - Number(a.size);
        return new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime();
      });
  }, [data, q, sortBy, f.locale]);

  const folders: TrashedFolder[] = useMemo(() => {
    const raw: TrashedFolder[] = data?.allTrashedFolders ?? [];
    return raw
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name, f.locale);
        return new Date(b.trashedAt || 0).getTime() - new Date(a.trashedAt || 0).getTime();
      });
  }, [data, q, sortBy, f.locale]);

  /* Layar tanpa izin — hanya tercapai lewat URL langsung; menu Trash
     memang tidak dirender untuk role lain. */
  if (!allowed) {
    return (
      <div className={styles.denyWrap}>
        <StatusMark variant="locked" />
        <h1 className={`${styles.denyTitle} spine-display-title`}>{t("deniedTitle")}</h1>
        <p className={`${styles.denyText} spine-body-lead`}>
          {t("deniedText")}
        </p>
        <Link href="/dashboard" className={`${styles.denyLink} spine-button spine-focus-ring`}>
          ← {t("backToMedia")}
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
        p.kind === "restore" ? t("restoredAnnounce", { name: p.name }) : t("deletedAnnounce", { name: p.name }),
      );
      pushToast({
        tone: "success",
        message: p.kind === "restore" ? t("restoredToast") : t("deletedToast"),
      });
    } catch (err) {
      console.error("Trash action failed", err);
      setPending(null);
      pushToast({
        tone: "error",
        message: p.kind === "restore" ? t("restoreFailed") : t("deleteFailed"),
        cause: humanize(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmTitle = !pending
    ? ""
    : pending.kind === "restore"
      ? pending.target === "file"
        ? t("confirm.restoreFileTitle")
        : t("confirm.restoreSectionTitle")
      : t("confirm.deleteTitle");

  const confirmLead = !pending
    ? null
    : pending.kind === "restore"
      ? pending.target === "file"
        ? t("confirm.restoreFileLead")
        : t("confirm.restoreSectionLead")
      : pending.target === "file"
        ? t("confirm.deleteFileLead", { name: pending.name })
        : t("confirm.deleteSectionLead", { name: pending.name });

  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <Link href="/dashboard" className={`${styles.backPill} spine-hit-area spine-focus-ring spine-link`}>
          ← {t("backToMedia")}
        </Link>
        <h1 className={`${styles.pageTitle} spine-display-page`}>
          <span className={styles.pageTitleText}>{t("title")}</span>
          {rawTotal > 0 ? <TagPill>{t("itemCount", { count: rawTotal })}</TagPill> : null}
        </h1>
        <p className={`${styles.pageSub} spine-body-sub`}>
          {t.rich("subtitle", { days: RETENTION_DAYS, b: (chunks) => <b>{chunks}</b> })}
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
            placeholder={t("search")}
            aria-label={t("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className={styles.sortPills} role="group" aria-label={t("sortGroup")}>
          {SORT_FIELDS.map(({ field }) => (
            <button
              key={field}
              type="button"
              aria-pressed={sortBy === field}
              className={`${styles.sortPill} ${sortBy === field ? styles.sortPillActive : ""} spine-sort spine-focus-ring`}
              onClick={() => setSortBy(field)}
            >
              {t(`sort.${field}`)}
            </button>
          ))}
        </div>
      </div>

      <p className="spine-visually-hidden" role="status">
        {announce}
      </p>
      {/* Hasil pencarian diumumkan polite, terpisah dari hasil aksi. */}
      <p className="spine-visually-hidden" role="status">
        {q ? t("results", { count: total, query: query.trim() }) : ""}
      </p>

      {loading && !data ? (
        <div className={styles.loadingBlock}>
          <p className={`${styles.loadingText} spine-body`}>{t("loading")}</p>
          <SkeletonRow rows={3} variant="card" />
        </div>
      ) : error ? (
        <ErrorBox
          title={t("errorTitle")}
          text={t("errorText")}
          onRetry={() => void refetch()}
        />
      ) : total === 0 ? (
        q ? (
          <EmptyState
            variant="none"
            title={t("noResultsTitle", { query: query.trim() })}
            text={t("noResultsText")}
          />
        ) : (
          <EmptyState
            variant="ghost"
            title={t("emptyTitle")}
            text={t("emptyText", { days: RETENTION_DAYS })}
          />
        )
      ) : (
        <>
          {folders.length > 0 ? (
            <section className={styles.group}>
              <div className={styles.groupHead}>
                <h2 className={`${styles.groupTitle} spine-display-panel-mobile`}>{t("groupSections")}</h2>
                <span className={`${styles.countChip} spine-chip`}>
                  {f.number(folders.length)}
                </span>
              </div>
              <div className={styles.table} role="table" aria-label={t("sectionsTable")}>
                <div className={styles.headRow} role="row">
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    {t("column.name")}
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    {t("column.project")}
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    {t("column.remaining")}
                  </span>
                  <span role="columnheader" className="spine-visually-hidden">
                    {t("column.actions")}
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
                                {tc("numberPrefix")}
                              </span>
                              <span className="spine-visually-hidden">{tc("number")}</span> {number}
                            </span>
                          ) : null}
                          <b className={`${styles.rowName} spine-row-title`} title={title}>
                            {title}
                          </b>
                        </span>
                      </div>
                      <div className={`${styles.cell} ${styles.cellPlain} spine-body`} role="cell">
                        {f.project?.title || t("noProject")}
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
                              meta: t("metaSection", { project: f.project?.title || t("noProject"), remaining: remainingText(left) }),
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_RESTORE}
                          </span>
                          {t("restore")}
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
                              meta: t("metaSection", { project: f.project?.title || t("noProject"), remaining: remainingText(left) }),
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_TRASH}
                          </span>
                          {t("deleteForever")}
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
                <h2 className={`${styles.groupTitle} spine-display-panel-mobile`}>{t("groupFiles")}</h2>
                <span className={`${styles.countChip} spine-chip`}>
                  {f.number(files.length)}
                </span>
              </div>
              <div className={styles.table} role="table" aria-label={t("filesTable")}>
                <div className={styles.headRow} role="row">
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    {t("column.name")}
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    {t("column.size")}
                  </span>
                  <span role="columnheader" className={`${styles.headCell} spine-label`}>
                    {t("column.remaining")}
                  </span>
                  <span role="columnheader" className="spine-visually-hidden">
                    {t("column.actions")}
                  </span>
                </div>
                {files.map((file) => {
                  const left = daysLeft(file.trashedAt);
                  const size = f.fileSize(Number(file.size));
                  const thumb = (
                    <RepThumb
                      variant="file"
                      file={{ kind: fileKind(file.mimeType), extension: fileExtension(file.originalName) }}
                    />
                  );
                  return (
                    <div key={file.id} className={styles.row} role="row">
                      <div className={`${styles.cell} ${styles.cellContent}`} role="cell">
                        {thumb}
                        <span className={styles.titleLine}>
                          <b className={`${styles.rowName} spine-row-title`} title={file.originalName}>
                            {file.originalName}
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
                              id: file.id,
                              name: file.originalName,
                              meta: t("metaFile", { size, remaining: remainingText(left) }),
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_RESTORE}
                          </span>
                          {t("restore")}
                        </PillButton>
                        {canPurge ? (
                        <ButtonDanger
                          variant="outline"
                          className={styles.actionBtn}
                          onClick={() =>
                            setPending({
                              kind: "delete",
                              target: "file",
                              id: file.id,
                              name: file.originalName,
                              meta: t("metaFile", { size, remaining: remainingText(left) }),
                              thumb,
                            })
                          }
                        >
                          <span className={styles.actionIcon} aria-hidden="true">
                            {ICON_TRASH}
                          </span>
                          {t("deleteForever")}
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
          /* Restore is not destructive -> accent button; Delete
             Forever → `button-danger.solid` + `role="alertdialog"`. */
          tone={pending.kind === "restore" ? "recoverable" : "permanent"}
          /* Delete Forever = peringatan (`alertdialog`); Restore bukan —
             mock `key-trash.html` 05 merendernya sebagai `dialog` biasa. */
          alert={pending.kind !== "restore"}
          confirmLabel={pending.kind === "restore" ? t("restore") : t("deleteForever")}
          busyLabel={pending.kind === "restore" ? t("restoring") : t("deleting")}
          busy={busy}
          preview={{ thumb: pending.thumb, name: pending.name, meta: pending.meta }}
          onConfirm={() => void runAction()}
          onClose={() => (busy ? undefined : setPending(null))}
        />
      ) : null}
    </div>
  );
}

/**
 * `remaining-chip` — sisa retensi 30 hari. Pada ≤ 3 hari chip berubah
 * menjadi tint danger + ikon peringatan + teks tebal: arti TIDAK pernah
 * dibawa warna saja. Ikon `aria-hidden`; kalimatnya terbaca utuh.
 */
function RemainingChip({ days }: { days: number | null }) {
  const t = useTranslations("trash");
  const urgent = days !== null && days <= URGENT_DAYS;
  return (
    <span className={`${styles.remainingChip} ${urgent ? styles.remainingUrgent : ""}`}>
      <span className={styles.remainingIcon} aria-hidden="true">
        {urgent ? ICON_WARN : ICON_CLOCK}
      </span>
      <span className="spine-chip">
        {days === null ? t("remainingUnknown") : t("remainingDays", { count: days })}
      </span>
    </span>
  );
}
