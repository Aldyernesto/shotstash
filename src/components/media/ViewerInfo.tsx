"use client";

/**
 * Story 3.6 — `viewer-info-panel` (desktop) & `viewer-info-sheet` (HP).
 *
 * Ini SATU-SATUNYA bagian `file-viewer` yang ikut tema; lapisan di
 * sekelilingnya tetap gelap di dua tema.
 *
 * Aturan keras `<dl>`:
 *  - Urutan SELALU sama: Tipe · Ukuran · Dimensi · Diambil · Diunggah ·
 *    Project · Section. Baris tanpa nilai TETAP DIRENDER dengan "—"
 *    (bukan dihapus), didampingi teks tersembunyi-visual "Tidak ada"
 *    supaya pembaca layar membaca "Diambil, Tidak ada", bukan "strip".
 *  - "Captured" comes from camera EXIF, which stores no time zone: it is
 *    written as is plus "(camera time)" and never converted. A value that
 *    cannot be parsed is treated as empty (never shown raw, never guessed),
 *    and the "(camera time)" label is not rendered when empty.
 *  - "Uploaded" uses the viewer's locale and browser time zone, with a
 *    zone label (useFormat().dateTime).
 *  - Metadata kosong TIDAK PERNAH memunculkan pesan error di layar;
 *    kegagalan membacanya dicatat ke konsol.
 *
 * Lembar HP adalah `<section>` DI DALAM `role="dialog"` viewer — bukan
 * dialog kedua — sehingga aturan satu lapisan modal tetap terjaga.
 *
 * Story 4.4: processed versions (the HEIC preview today, pipeline outputs
 * with Epic 5) are listed under "Versions" with kind, type, size and date,
 * each with a download link (`/media/p/<id>`, same permission as the file).
 * The original never changes.
 */

import React, { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./viewerInfo.module.css";
import { useFormat } from "@/i18n/useFormat";
import { parseSectionName } from "@/lib/sectionNumber";
import { StatusChip } from "@/components/form/StatusChip";

/** A processed version as the GraphQL `ProcessedVersion` type answers it. */
export type ViewerVersion = {
  id: string;
  kind: string;
  mimeType: string;
  size?: number | string | null;
  createdAt?: string | number | Date | null;
  downloadUrl: string;
};

export type ViewerInfoFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size?: number | string | null;
  createdAt?: string | number | Date | null;
  /** Lebar × tinggi TAMPIL (sudah dikoreksi rotasi). Skema tidak
      menyimpannya; `FileViewer` mengisinya dari elemen media yang sedang
      terbuka (videoWidth/videoHeight, naturalWidth/naturalHeight). */
  width?: number | null;
  height?: number | null;
  /** String EXIF MENTAH dari kamera. Jangan pernah oper `Date` ke sini. */
  capturedAtRaw?: string | null;
  /** Durasi video "02:18" bila diketahui. */
  duration?: string | null;
  /** Story 4.4: outputs derived from this file, newest first. */
  processedVersions?: ViewerVersion[] | null;
};

export type ViewerInfoProps = {
  variant: "panel" | "sheet";
  file: ViewerInfoFile;
  projectTitle?: string | null;
  sectionName?: string | null;
  onClose: () => void;
};

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const ChevronUpIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 14.5l6-6 6 6" />
  </svg>
);
const PhotoIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
    <circle cx="8.5" cy="9.5" r="1.4" />
  </svg>
);
const FilmIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M8 5v14M16 5v14M3 12h18" />
  </svg>
);

/** Empty value: a dash plus visually hidden "None" for screen readers. */
function NoneValue() {
  const t = useTranslations("viewer.info");
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="spine-visually-hidden">{t("none")}</span>
    </>
  );
}
const NONE = <NoneValue />;

const DownloadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
  </svg>
);

/** Known kinds read as words; anything else (a future pipeline kind) is shown as is. */
function useKindLabel() {
  const t = useTranslations("viewer.info.versions");
  return (kind: string) => (t.has(`kind.${kind}` as never) ? t(`kind.${kind}` as never) : kind);
}

function VersionsList({ versions }: { versions: ViewerVersion[] }) {
  const t = useTranslations("viewer.info.versions");
  const f = useFormat();
  const kindLabel = useKindLabel();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={styles.versions}>
      <p id={titleId} className={`spine-label ${styles.versionsTitle}`}>
        {t("title")}
      </p>
      <ul className={styles.versionList}>
        {versions.map((v) => {
          const type = (v.mimeType.split("/").pop() || "").toUpperCase();
          const label = kindLabel(v.kind);
          return (
            <li key={v.id} className={styles.version}>
              <div className={styles.versionText}>
                <StatusChip tone="ok">{label}</StatusChip>
                <span className={`spine-body-sm ${styles.versionMeta}`}>
                  {[type, v.size != null ? f.fileSize(Number(v.size)) : null, v.createdAt ? f.dateTime(v.createdAt) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <a
                className={`spine-focus-ring ${styles.versionDownload}`}
                href={v.downloadUrl}
                download
                aria-label={t("download", { kind: label })}
                title={t("download", { kind: label })}
              >
                {DownloadIcon}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function typeLabel(mime: string, name: string, duration?: string | null): React.ReactNode {
  const ext = (name.split(".").pop() || "").toUpperCase();
  const base = ext && ext.length <= 5 ? ext : mime.split("/").pop()?.toUpperCase() || "";
  if (!base) return NONE;
  return duration ? `${base} · ${duration}` : base;
}

/**
 * EXIF apa adanya. Nilai yang bukan string bermakna (kosong, spasi, atau
 * hanya tanda baca) diperlakukan sebagai TIDAK ADA — tidak ditebak dan
 * tidak ditampilkan mentah.
 */
function capturedValue(raw: string | null | undefined, cameraTime: (raw: string) => string): React.ReactNode {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || !/\d/.test(text)) {
    if (raw) {
      // Bukan ke layar: kegagalan membaca metadata dicatat ke konsol.
      console.warn("[viewer-info] unparseable EXIF capture time:", raw);
    }
    return NONE;
  }
  return cameraTime(text);
}

export function ViewerInfo({ variant, file, projectTitle, sectionName, onClose }: ViewerInfoProps) {
  const t = useTranslations("viewer.info");
  const tc = useTranslations("common");
  const f = useFormat();
  const isVideo = file.mimeType.startsWith("video/");
  /** Lembar HP punya DUA tinggi: intip 300px dan penuh (maks 85%). */
  const [height, setHeight] = useState<"peek" | "full">("peek");
  const titleRef = useRef<HTMLParagraphElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const touch = useRef<number | null>(null);

  // Fokus pindah ke judul lembar saat dibuka; kembalinya ke ⓘ diurus
  // pemanggil (`FileViewer`).
  useEffect(() => {
    if (variant !== "sheet") return;
    titleRef.current?.focus({ preventScroll: true });
  }, [variant]);

  // "2160 × 3840 px · Potret (9:16)" — orientasi + rasio umum ikut ditulis
  // karena itulah yang dicari editor (klip 9:16 untuk Reels), bukan angkanya.
  const dimensions =
    file.width && file.height
      ? f.dimensions(file.width, file.height)
      : NONE;

  const rows: [string, React.ReactNode][] = [
    [t("type"), typeLabel(file.mimeType, file.originalName, file.duration)],
    [t("size"), file.size != null ? f.fileSize(Number(file.size)) : NONE],
    [t("dimensions"), dimensions],
    [t("captured"), capturedValue(file.capturedAtRaw, f.cameraTime)],
    [t("uploaded"), file.createdAt ? f.dateTime(file.createdAt) : NONE],
  ];

  const section = sectionName ? parseSectionName(sectionName) : null;

  const body = (
    <>
      <p ref={titleRef} tabIndex={-1} className={`spine-display-card ${styles.fileName}`}>
        {file.originalName}
      </p>
      <dl className={styles.dl}>
        {rows.map(([dt, dd]) => (
          <React.Fragment key={dt}>
            <dt>{dt}</dt>
            <dd>{dd}</dd>
          </React.Fragment>
        ))}
      </dl>
      <hr className={styles.rule} />
      <dl className={styles.dl}>
        <dt>{t("project")}</dt>
        <dd>{projectTitle || NONE}</dd>
        <dt>{t("section")}</dt>
        <dd>
          {section ? (
            <span className={styles.location}>
              {section.number ? (
                /* The number sticker stays an accent block with white text in BOTH themes. */
                <span className={`spine-display-label ${styles.numberSticker}`}>
                  <span aria-hidden="true">{tc("numberPrefix")}</span>
                  <span className="spine-visually-hidden">{tc("number")}</span> {section.number}
                </span>
              ) : null}
              <b className={styles.sectionName}>{section.title}</b>
            </span>
          ) : (
            NONE
          )}
        </dd>
      </dl>
      {file.processedVersions?.length ? (
        <>
          <hr className={styles.rule} />
          <VersionsList versions={file.processedVersions} />
        </>
      ) : null}
    </>
  );

  const head = (
    <div className={styles.head}>
      <span className={`spine-label ${styles.headLabel}`}>
        {t("title")}
        <span className={styles.kindChip}>
          {isVideo ? FilmIcon : PhotoIcon}
          {isVideo ? t("kindVideo") : t("kindPhoto")}
        </span>
      </span>
      <button
        type="button"
        className={`spine-focus-ring ${styles.close}`}
        aria-label={t("close")}
        onClick={onClose}
      >
        {CloseIcon}
      </button>
    </div>
  );

  if (variant === "panel") {
    return (
      <section aria-label={t("title")} className={styles.panel}>
        {head}
        {body}
      </section>
    );
  }

  /* -------------------- lembar HP -------------------- */
  return (
    <>
      {height === "full" ? <div className={styles.dim} aria-hidden="true" /> : null}
      <section
        ref={sheetRef}
        aria-label={t("title")}
        className={`${styles.sheet} ${height === "peek" ? styles.peek : styles.full}`}
        onTouchStart={(e) => {
          touch.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (start == null) return;
          const dy = e.changedTouches[0].clientY - start;
          // Tarik gagang ke BAWAH: penuh → intip → tutup.
          if (dy > 48) {
            if (height === "full") setHeight("peek");
            else onClose();
          } else if (dy < -48) {
            setHeight("full");
          }
        }}
      >
        {/* Gagang adalah TOMBOL 96 × 28 px — gestur tarik bukan
            satu-satunya jalan (area sentuh 48px lewat `hit-area`). */}
        <button
          type="button"
          className={`spine-focus-ring spine-hit-area ${styles.grab}`}
          aria-label={height === "peek" ? t("expand") : t("collapse")}
          onClick={() => setHeight((h) => (h === "peek" ? "full" : "peek"))}
        >
          <i aria-hidden="true" />
        </button>
        {head}
        {body}
        {height === "peek" ? (
          <button
            type="button"
            className={`spine-focus-ring ${styles.more}`}
            onClick={() => setHeight("full")}
          >
            {ChevronUpIcon}
            {t("showAll")}
          </button>
        ) : null}
      </section>
    </>
  );
}
