"use client";

/**
 * Story 3.8 — `share-modal`, SATU-SATUNYA pembuat link `/s/[slug]`.
 *
 * Menggantikan `src/components/ShareModal.tsx` (overlay tulisan tangan,
 * `<select>` kedaluwarsa, `alert()` salin). Dibangun di atas lapisan
 * bersama gelombang ini dan TIDAK membangun ulang satu pun darinya:
 *   - `Dialog` + `modalStack` (Story 3.1) — satu lapisan modal, fokus
 *     terkunci, Esc/Batal menutup, fokus kembali ke pemicu.
 *   - `RadioCardGroup` (Story 3.1) — Mode akses & Kedaluwarsa.
 *   - `CopyPill` (Story 3.2) — alamat + salin; "Salin Tautan" memakai
 *     `action` milik pill itu, jadi hanya ADA SATU sumber salin dan satu
 *     kalimat cadangan bila clipboard ditolak browser.
 *   - `FormAlert` (Story 1.15) — kegagalan membuat tautan.
 *
 * Story 4.6 (FR33 / UX-DR50) — bagian "Link aktif" + cabut akses DI DALAM
 * baris, mengisi slot yang dikosongkan Story 3.8:
 *   - isi dari `shareLinksForTarget` (Story 4.4) dengan TEPAT SATU argumen
 *     sesuai target modal; kepala "Link aktif untuk file/Section/project
 *     ini" (SUPER_ADMIN/ADMIN) atau "Link aktif milikmu" (role lain) +
 *     `count-chip` "{n} link"; tanpa link → satu kalimat, bukan kepala
 *     tabel kosong;
 *   - tiap baris: `copy-pill` (seluruhnya tombol salin), `status-chip` mode,
 *     chip kedaluwarsa WIB / "Permanen", "{n} kali dilihat", "dibuat {nama}"
 *     / "dibuat kamu", `button-danger.outline` "Cabut Akses";
 *   - konfirmasi MENGGANTI isi baris (tint danger-bg + ikon + kalimat +
 *     Batal / `button-danger.solid`) — tidak ada dialog kedua; fokus awal
 *     di "Batal"; Esc membatalkan lewat lapisan NON-modal di atas dialog
 *     dan mengembalikan fokus ke "Cabut Akses" baris itu tanpa menutup
 *     modal; konfirmasi kedua menutup yang pertama;
 *   - link yang baru dibuat di modal ini naik ke atas bertag "BARU";
 *   - sukses → baris hilang, chip berkurang, live region "Link dicabut.";
 *     gagal → toast error, baris tetap.
 *   Bloknya dirender lewat prop `after` Dialog: desktop di bawah deret
 *   tombol (mock 01), HP di dalam isi yang bergulir di atas footer yang
 *   menempel (mock 03).
 *
 * Aturan yang tidak bisa ditawar:
 *   - Role VIEWER melihat modal yang IDENTIK: tanpa label blur, tanpa
 *     "Versi aman", tanpa peringatan (OQ-X27). Satu-satunya cabang role di
 *     berkas ini adalah KALIMAT KEPALA daftar (hak lihat), bukan perilaku
 *     link — link buatan Agen tetap menyajikan file asli.
 *   - Tidak ada pilihan "hanya lihat" dan tidak ada kata sandi.
 *
 * Nilai terukur dari mock `key-share-modal.html` (01/02/03/04).
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import { Dialog } from "@/components/overlay/Dialog";
import { useModalLayer } from "@/components/overlay/modalStack";
import { RadioCardGroup } from "@/components/overlay/fields";
import { ButtonDanger, ButtonPrimary, PillButton } from "@/components/form/buttons";
import { FormAlert } from "@/components/form/FormAlert";
import { StatusChip } from "@/components/form/StatusChip";
import { CopyPill } from "@/components/feedback/CopyPill";
import { useToast, humanizeError } from "@/components/feedback/ToastProvider";
import RepThumb from "@/components/dashboard/RepThumb";
import type { RepFile } from "@/components/dashboard/ProjectCard";
import { useAuth } from "@/components/AuthContext";
import { isAdmin } from "@/lib/permissions";
import { formatDate, formatDateTimeWIB, formatNumber, formatTimeWIB } from "@/lib/format";
import { parseSectionName } from "@/lib/sectionNumber";
import styles from "./shareModal.module.css";

const CREATE_SHARE_LINK = gql`
  mutation CreateShareLink($input: ShareLinkInput!) {
    createShareLink(input: $input) {
      id
      slug
      url
      mode
      expiresAt
    }
  }
`;

/* Story 4.6: daftar link aktif untuk TEPAT SATU target (Story 4.4). */
const SHARE_LINKS_FOR_TARGET = gql`
  query ShareLinksForTarget($fileId: ID, $folderId: ID, $projectId: ID) {
    shareLinksForTarget(fileId: $fileId, folderId: $folderId, projectId: $projectId) {
      id
      slug
      url
      mode
      expiresAt
      accessCount
      createdAt
      createdBy {
        id
        name
      }
    }
  }
`;

const REVOKE_SHARE_LINK = gql`
  mutation RevokeShareLinkInline($id: ID!) {
    revokeShareLink(id: $id)
  }
`;

export type ShareTargetKind = "file" | "section" | "project";

export type ShareModalProps = {
  kind: ShareTargetKind;
  /** fileId / folderId / projectId sesuai `kind`. */
  id: string;
  /** Nama item apa adanya (awalan "25. " dibuang di sini untuk Section). */
  name: string;
  /** Jumlah file di dalam item — baris identitas. */
  fileCount?: number | null;
  /** Jumlah Section (varian Project) — baris identitas. */
  sectionCount?: number | null;
  /** Nama Project induk (varian Section) / Section induk (varian file). */
  parentName?: string | null;
  /** Ukuran file, sudah diformat (varian file). */
  sizeText?: string | null;
  /** "Video · 02:47" bagian jenisnya (varian file). */
  kindLabel?: string | null;
  /** Kartu perwakilan untuk `rep-thumb` (Section / Project). */
  repFiles?: RepFile[] | null;
  /** Varian file: satu kartu. */
  file?: { kind?: string | null; thumbnailUrl?: string | null; extension?: string | null } | null;
  onClose: () => void;
};

type Mode = "PUBLIC" | "PRIVATE";
type Expiry = "24" | "168" | "never";

type ActiveLink = {
  id: string;
  slug: string;
  url: string;
  mode: Mode;
  expiresAt: string | null;
  accessCount: number;
  createdAt: string;
  createdBy: { id: string; name: string };
};

const TITLE: Record<ShareTargetKind, string> = {
  file: "Bagikan File",
  section: "Bagikan Section",
  project: "Bagikan Project",
};

/** Kata target untuk kepala & kalimat kosong bagian "Link aktif". */
const TARGET_WORD: Record<ShareTargetKind, string> = {
  file: "file ini",
  section: "Section ini",
  project: "project ini",
};

const ICON_GLOBE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
  </svg>
);

const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8.5 11V8.2a3.5 3.5 0 0 1 7 0V11" />
  </svg>
);

const ICON_CLOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const ICON_INFINITY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M7 8C4.5 8 3 9.8 3 12s1.5 4 4 4c3.5 0 6.5-8 10-8 2.5 0 4 1.8 4 4s-1.5 4-4 4c-3.5 0-6.5-8-10-8z" />
  </svg>
);

const ICON_LINK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1" />
  </svg>
);

const ICON_OK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const ICON_COPY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </svg>
);

/* Ikon cabut (lingkaran bergaris) dan peringatan — sama dengan mock `.pill.x`
   dan `.exr.conf .ct-t svg`; selalu `aria-hidden`, arti ada di teksnya. */
const ICON_REVOKE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </svg>
);

const ICON_ALERT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </svg>
);

const HOURS: Record<Expiry, number | null> = { "24": 24, "168": 168, never: null };

const MODE_WORD: Record<Mode, string> = { PUBLIC: "Public", PRIVATE: "Private" };

export default function ShareModal({
  kind,
  id,
  name,
  fileCount,
  sectionCount,
  parentName,
  sizeText,
  kindLabel,
  repFiles,
  file,
  onClose,
}: ShareModalProps) {
  const [mode, setMode] = useState<Mode>("PUBLIC");
  const [expiry, setExpiry] = useState<Expiry>("24");
  const [result, setResult] = useState<{ url: string; slug: string; mode: Mode; expiresAt: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const expiryNoteId = useId();
  const alertId = useId();
  const uid = useId();

  const [createShareLink] = useMutation(CREATE_SHARE_LINK);

  /* ---------------- Story 4.6: daftar "Link aktif" ---------------- */

  const { user } = useAuth();
  const adminView = isAdmin(user);
  const { pushToast } = useToast();
  const targetVars = useMemo(
    () => ({
      fileId: kind === "file" ? id : null,
      folderId: kind === "section" ? id : null,
      projectId: kind === "project" ? id : null,
    }),
    [kind, id],
  );
  const linksQuery = useQuery(SHARE_LINKS_FOR_TARGET, {
    variables: targetVars,
    fetchPolicy: "cache-and-network",
  });
  const [revokeShareLink] = useMutation(REVOKE_SHARE_LINK);

  /** Id link yang dibuat DI modal ini — mendapat tag "BARU" dan naik ke atas. */
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Baris yang sedang menampilkan konfirmasi cabut (satu saja). */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  /** Baris yang harus menerima fokus kembali setelah konfirmasi dibatalkan. */
  const [returnFocusId, setReturnFocusId] = useState<string | null>(null);
  /** Pengumuman polite — tidak memindahkan fokus. */
  const [announce, setAnnounce] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const revokeBtnRefs = useRef(new Map<string, HTMLButtonElement>());

  const rawLinks: ActiveLink[] = linksQuery.data?.shareLinksForTarget ?? [];
  // Server sudah mengurutkan createdAt menurun; link buatan modal ini
  // dipastikan paling atas (sort stabil, urutan lain tidak berubah).
  const links = useMemo(
    () => [...rawLinks].sort((a, b) => Number(freshIds.has(b.id)) - Number(freshIds.has(a.id))),
    [rawLinks, freshIds],
  );

  // Esc saat konfirmasi baris terbuka: lapisan NON-modal di atas dialog —
  // membatalkan konfirmasi itu saja, modal tetap terbuka.
  useModalLayer(
    () => {
      if (revoking) return;
      setReturnFocusId(confirmId);
      setConfirmId(null);
    },
    { modal: false, enabled: confirmId !== null },
  );

  // Fokus awal konfirmasi SELALU di "Batal".
  useEffect(() => {
    if (confirmId) cancelRef.current?.focus({ preventScroll: true });
  }, [confirmId]);

  // Setelah dibatalkan: fokus kembali ke "Cabut Akses" baris itu.
  useEffect(() => {
    if (confirmId !== null || !returnFocusId) return;
    revokeBtnRefs.current.get(returnFocusId)?.focus({ preventScroll: true });
    setReturnFocusId(null);
  }, [confirmId, returnFocusId]);

  const openConfirm = (linkId: string) => {
    // Konfirmasi di baris lain menutup konfirmasi sebelumnya lebih dulu.
    setReturnFocusId(null);
    setConfirmId(linkId);
  };

  const cancelConfirm = () => {
    if (revoking) return;
    setReturnFocusId(confirmId);
    setConfirmId(null);
  };

  const runRevoke = async (link: ActiveLink) => {
    if (revoking) return;
    setRevoking(true);
    try {
      await revokeShareLink({ variables: { id: link.id } });
      await linksQuery.refetch();
      setConfirmId(null);
      setAnnounce("Link dicabut.");
      // Barisnya sudah tidak ada — fokus mendarat di kepala bagian supaya
      // tetap di dalam modal.
      headingRef.current?.focus({ preventScroll: true });
    } catch (err) {
      // Baris TETAP ada (konfirmasi tetap terbuka) supaya aksi bisa diulang;
      // pesan mentah server tidak pernah menjadi isi toast.
      pushToast({
        tone: "error",
        message: "Gagal mencabut akses link. Coba lagi.",
        cause: humanizeError(err),
      });
    } finally {
      setRevoking(false);
    }
  };

  // Titik acuan dibekukan saat modal dibuka: kalimat jam tidak boleh
  // berjalan sendiri sementara pengguna membaca pilihannya.
  const openedAt = useMemo(() => Date.now(), []);
  const expiresAtPreview =
    expiry === "never" ? null : new Date(openedAt + (HOURS[expiry] as number) * 3600_000);

  const shown = kind === "section" ? parseSectionName(name).title : name;

  // Baris identitas — format per varian, persis mock:
  //   Section : "Section · 72 file · {Project}"
  //   Project : "Project · 2.600 file · 14 Section"
  //   File    : "{jenis} · {ukuran} · {Section induk}"
  const metaParts = (
    kind === "project"
      ? [
          "Project",
          typeof fileCount === "number" ? `${formatNumber(fileCount)} file` : null,
          typeof sectionCount === "number" ? `${formatNumber(sectionCount)} Section` : null,
        ]
      : kind === "section"
        ? [
            "Section",
            typeof fileCount === "number" ? `${formatNumber(fileCount)} file` : null,
            parentName || null,
          ]
        : [kindLabel || "File", sizeText || null, parentName || null]
  ).filter(Boolean) as string[];

  const submit = async () => {
    // Kiriman kedua diabaikan.
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { data } = await createShareLink({
        variables: {
          input: {
            fileId: kind === "file" ? id : undefined,
            folderId: kind === "section" ? id : undefined,
            projectId: kind === "project" ? id : undefined,
            mode,
            expiresInHours: HOURS[expiry],
          },
        },
      });
      const link = data?.createShareLink;
      if (!link?.url || !link?.slug) throw new Error("no url");
      setResult({ url: link.url, slug: link.slug, mode, expiresAt: link.expiresAt ?? null });
      // Link baru masuk daftar "Link aktif" tanpa menutup-membuka modal.
      setFreshIds((prev) => new Set(prev).add(link.id));
      linksQuery.refetch().catch(() => undefined);
    } catch {
      // Pesan MENTAH server tidak pernah ditampilkan (EXPERIENCE.md).
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const heading = adminView ? `Link aktif untuk ${TARGET_WORD[kind]}` : "Link aktif milikmu";
  const linksLoading = linksQuery.loading && !linksQuery.data;
  const linksFailed = Boolean(linksQuery.error) && !linksQuery.data;

  const activeLinks = (
    <section className={styles.active} aria-labelledby={`${uid}-active-h`}>
      <div className={styles.activeHead} ref={headingRef} tabIndex={-1}>
        <span id={`${uid}-active-h`} className={`spine-label ${styles.legend} ${styles.activeLegend}`}>
          {heading}
        </span>
        {/* Tanpa link: kepala tetap, TANPA count-chip (mock 04). */}
        {!linksLoading && !linksFailed && links.length > 0 ? (
          <span className={`spine-chip ${styles.countChip}`}>{formatNumber(links.length)} link</span>
        ) : null}
      </div>
      <p className="spine-visually-hidden" role="status">
        {announce}
      </p>

      {linksLoading ? (
        <p className={`spine-footnote ${styles.activeNote}`}>Memuat link…</p>
      ) : linksFailed ? (
        <p className={`spine-footnote ${styles.activeNote}`} role="alert">
          Gagal memuat link aktif.{" "}
          <button
            type="button"
            className={`spine-focus-ring ${styles.activeRetry}`}
            onClick={() => {
              linksQuery.refetch().catch(() => undefined);
            }}
          >
            Coba lagi
          </button>
        </p>
      ) : links.length === 0 ? (
        <p className={`spine-footnote ${styles.activeNote}`}>Belum ada link untuk {TARGET_WORD[kind]}.</p>
      ) : (
        <ul className={styles.linkList}>
          {links.map((link) => {
            const confirming = confirmId === link.id;
            const mine = !!user?.id && link.createdBy?.id === user.id;
            return (
              <li
                key={link.id}
                className={`${styles.linkRow} ${confirming ? styles.linkRowConfirm : ""}`}
              >
                {confirming ? (
                  <div
                    role="group"
                    aria-labelledby={`${uid}-cf-t`}
                    aria-describedby={`${uid}-cf-s`}
                  >
                    <div className={styles.confirmHead}>
                      <span className={styles.confirmIcon} aria-hidden="true">
                        {ICON_ALERT}
                      </span>
                      <div>
                        <b id={`${uid}-cf-t`} className={styles.confirmTitle}>
                          Cabut akses link ini?
                        </b>
                        <span id={`${uid}-cf-s`} className={styles.confirmText}>
                          Link <b>/s/{link.slug}</b> tidak akan bisa diakses lagi.
                        </span>
                      </div>
                    </div>
                    <div className={styles.confirmActions}>
                      <PillButton
                        ref={cancelRef}
                        variant="surface"
                        className={styles.confirmBtn}
                        aria-disabled={revoking || undefined}
                        onClick={cancelConfirm}
                      >
                        Batal
                      </PillButton>
                      <ButtonDanger
                        variant="solid"
                        className={styles.confirmBtn}
                        aria-busy={revoking || undefined}
                        aria-disabled={revoking || undefined}
                        onClick={() => void runRevoke(link)}
                      >
                        {revoking ? (
                          "Mencabut…"
                        ) : (
                          <>
                            <span className={styles.btnIcon} aria-hidden="true">
                              {ICON_REVOKE}
                            </span>
                            Cabut Akses
                          </>
                        )}
                      </ButtonDanger>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.linkTop}>
                      <CopyPill slug={link.slug} href={link.url} className={styles.linkCopy} />
                      <ButtonDanger
                        variant="outline"
                        className={styles.linkRevoke}
                        aria-label={`Cabut akses /s/${link.slug}`}
                        ref={(el: HTMLButtonElement | null) => {
                          if (el) revokeBtnRefs.current.set(link.id, el);
                          else revokeBtnRefs.current.delete(link.id);
                        }}
                        onClick={() => openConfirm(link.id)}
                      >
                        <span className={styles.btnIcon} aria-hidden="true">
                          {ICON_REVOKE}
                        </span>
                        Cabut Akses
                      </ButtonDanger>
                    </div>
                    <div className={`spine-footnote ${styles.linkMeta}`}>
                      {/* Tag "BARU" (pill hitam invarian) di awal baris meta — mock 02 `.l2 .newt`. */}
                      {freshIds.has(link.id) ? (
                        <span className={`spine-display-sticker ${styles.newTag}`}>BARU</span>
                      ) : null}
                      <StatusChip
                        tone="neutral"
                        icon={link.mode === "PUBLIC" ? ICON_GLOBE : ICON_LOCK}
                        className={styles.linkChip}
                      >
                        {MODE_WORD[link.mode]}
                      </StatusChip>
                      <StatusChip
                        tone="neutral"
                        icon={link.expiresAt ? ICON_CLOCK : ICON_INFINITY}
                        className={styles.linkChip}
                      >
                        {/* Jam dihitung DI PERANGKAT, selalu bersufiks WIB. */}
                        {link.expiresAt ? `s.d. ${formatDateTimeWIB(link.expiresAt)}` : "Permanen"}
                      </StatusChip>
                      <span>
                        <b>{formatNumber(link.accessCount)}</b> kali dilihat
                      </span>
                      <span>
                        dibuat <b>{mine ? "kamu" : link.createdBy?.name}</b>
                      </span>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );

  return (
    <Dialog
      size="lg"
      mobilePlacement="bottom"
      mobilePreviewFirst={false}
      stickyFooter
      title={TITLE[kind]}
      closeLabel="Tutup"
      onClose={onClose}
      preview={{
        thumb: (
          <RepThumb
            variant={kind === "project" ? "project" : kind === "section" ? "section" : "file"}
            repFiles={repFiles ?? null}
            file={file ?? null}
            empty={kind !== "file" && !(repFiles && repFiles.length)}
          />
        ),
        name: <span>{shown}</span>,
        meta: metaParts.join(" · "),
      }}
      footer={
        result ? (
          <div className={`${styles.footer} ${styles.footerOne}`}>
            <PillButton variant="surface" onClick={onClose}>
              Selesai
            </PillButton>
          </div>
        ) : (
          <div className={styles.footer}>
            <PillButton variant="surface" aria-disabled={busy || undefined} onClick={() => (busy ? undefined : onClose())}>
              Batal
            </PillButton>
            <PillButton
              variant="yellow"
              busy={busy}
              busyLabel="Membuat..."
              aria-describedby={failed ? alertId : undefined}
              onClick={submit}
            >
              <span className={styles.btnIcon} aria-hidden="true">
                {ICON_LINK}
              </span>
              Buat Tautan
            </PillButton>
          </div>
        )
      }
      after={activeLinks}
    >
      {result ? (
        <div className={styles.result}>
          <div className={styles.okBox} role="status">
            <span className={styles.okIcon} aria-hidden="true">
              {ICON_OK}
            </span>
            <span className={styles.okText}>
              <b className={`spine-row-title ${styles.okTitle}`}>Tautan siap dibagikan</b>
              <span className={`spine-footnote ${styles.okSub}`}>
                {MODE_WORD[result.mode]}
                {" · "}
                {result.expiresAt
                  ? `berlaku sampai ${formatDate(result.expiresAt)}, ${formatTimeWIB(result.expiresAt)}`
                  : "berlaku sampai dicabut lewat Share atau halaman Shared"}
              </span>
            </span>
          </div>
          <CopyPill
            slug={result.slug}
            href={result.url}
            size="large"
            className={styles.copy}
            action={(copy) => (
              <ButtonPrimary arrow={false} type="button" className={styles.copyButton} onClick={copy}>
                <span className={styles.btnIcon} aria-hidden="true">
                  {ICON_COPY}
                </span>
                Salin Tautan
              </ButtonPrimary>
            )}
          />
        </div>
      ) : (
        <>
          <div className={styles.group}>
            <span className={`spine-label ${styles.legend}`} id={`${expiryNoteId}-m`}>
              Mode akses
            </span>
            <RadioCardGroup<Mode>
              label="Mode akses"
              layout="row"
              stackOnMobile
              value={mode}
              onChange={setMode}
              options={[
                {
                  value: "PUBLIC",
                  title: "Public",
                  note: "Siapa pun yang punya link bisa membuka.",
                  icon: ICON_GLOBE,
                },
                {
                  value: "PRIVATE",
                  title: "Private",
                  note: "Hanya user Shotstash yang sudah login.",
                  icon: ICON_LOCK,
                },
              ]}
            />
          </div>

          <div className={styles.group}>
            <span className={`spine-label ${styles.legend}`}>Kedaluwarsa</span>
            <RadioCardGroup<Expiry>
              label="Kedaluwarsa"
              layout="row"
              compact
              value={expiry}
              onChange={setExpiry}
              describedBy={expiryNoteId}
              options={[
                { value: "24", title: "24 jam" },
                { value: "168", title: "7 hari" },
                { value: "never", title: "Permanen" },
              ]}
            />
            {/* Kalimat jam absolut WIB, dihitung DI PERANGKAT; perubahannya
                diumumkan polite tanpa memindahkan fokus. */}
            <p id={expiryNoteId} className={`spine-footnote ${styles.expiry}`} role="status">
              <span className={styles.expiryIcon} aria-hidden="true">
                {expiresAtPreview ? ICON_CLOCK : ICON_INFINITY}
              </span>
              <span>
                {expiresAtPreview ? (
                  <>
                    Link berlaku sampai{" "}
                    <b className={styles.expiryStrong}>
                      {formatDate(expiresAtPreview)}, {formatTimeWIB(expiresAtPreview)}
                    </b>
                    .
                  </>
                ) : (
                  "Link berlaku sampai dicabut lewat Share atau halaman Shared."
                )}
              </span>
            </p>
          </div>

          {failed ? (
            <FormAlert id={alertId} tone="danger" className={styles.alert}>
              Gagal membuat tautan. Periksa koneksimu lalu coba lagi.
            </FormAlert>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
