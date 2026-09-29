"use client";

import React from "react";
import styles from "./RepThumb.module.css";
import type { RepFile } from "./ProjectCard";

/** Batas NFR6: satu `rep-thumb` tidak pernah memuat lebih dari 3 thumbnail. */
export const REP_THUMB_MAX = 3;

export type RepThumbVariant = "project" | "section" | "file";

export type RepThumbProps = {
  variant: RepThumbVariant;
  /** Sampel Kartu Perwakilan (Story 2.4) untuk varian project & section. */
  repFiles?: RepFile[] | null;
  /** Varian file: satu kartu. */
  file?: {
    kind?: string | null;
    thumbnailUrl?: string | null;
    extension?: string | null;
  } | null;
  /** `sm` = 56 × 64 px (HP / baris HP). */
  size?: "md" | "sm";
  /** Tidak ada isi sama sekali → slot hantu bergaris putus-putus. */
  empty?: boolean;
  /**
   * Story 3.22/3.23: target baris SUDAH DIHAPUS (tautan share yatim, baris
   * Trash tanpa sumber). Satu kartu putus-putus abu — bentuknya sengaja
   * BEDA dari `empty` (ghost slot with accent hatching = "belum ada isi").
   */
  gone?: boolean;
  className?: string;
};

function extLabel(value?: string | null): string {
  const raw = (value || "").replace(/^\./, "").trim();
  return raw && raw.length <= 4 ? raw.toUpperCase() : "";
}

/**
 * Satu kartu mini. Thumbnail memakai `<img loading="lazy" decoding="async">`
 * supaya anggaran byte `rep-thumb` benar-benar ditunda sampai barisnya
 * terlihat; kalau gambarnya gagal dimuat, `<img>`-nya disembunyikan dan
 * kotaknya jatuh ke `{colors.rep-placeholder}` — bukan ikon rusak browser.
 */
function MiniCard({
  file,
  className,
  isDoc: isDocProp,
}: {
  file?: RepFile | null;
  className: string;
  isDoc?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  const url = file?.thumbnailUrl;
  // Story 4.5: a document inside a stack or fan is a mini doc card too.
  const isDoc = isDocProp ?? file?.kind === "document";
  return (
    <span className={`${styles.card} ${className} ${isDoc ? styles.docCard : ""}`}>
      {url && !failed && !isDoc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.img}
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

function VideoMark() {
  return (
    <span className={styles.videoMark}>
      <svg viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
        <path d="M0 0l10 6-10 6z" />
      </svg>
    </span>
  );
}

/**
 * `rep-thumb` (Story 2.14) — cuplikan isi mini untuk baris daftar, memakai
 * aturan Kartu Perwakilan yang sama dengan mode grid (sampel harian dari
 * Story 2.4), BUKAN ikon generik.
 *
 * SELALU `aria-hidden="true"`: nama item sudah menjadi nama barisnya, jadi
 * kotak ini tidak boleh menambah suara kedua di pembaca layar.
 *
 * Dipakai ulang apa adanya oleh kepala sheet `context-menu`, baris identitas
 * `share-modal`, serta baris Shared & Trash di Epic 3 — tidak boleh ada
 * varian kedua.
 */
export default function RepThumb({
  variant,
  repFiles,
  file,
  size = "md",
  empty = false,
  gone = false,
  className,
}: RepThumbProps) {
  const sample = (repFiles ?? []).slice(0, REP_THUMB_MAX);
  const box = `${styles.box} ${size === "sm" ? styles.small : ""} ${className ?? ""}`;

  if (gone) {
    return (
      <span className={`${box} ${styles.single}`} aria-hidden="true">
        <span className={`${styles.card} ${styles.front} ${styles.goneCard}`} />
      </span>
    );
  }

  if (variant === "project") {
    return (
      <span className={`${box} ${styles.project}`} aria-hidden="true">
        <span className={styles.backPanel} />
        {empty || sample.length === 0 ? (
          <span className={styles.projectGhost} />
        ) : (
          <>
            <MiniCard file={sample[0]} className={styles.fan1} />
            <MiniCard file={sample[1]} className={styles.fan2} />
            <MiniCard file={sample[2]} className={styles.fan3} />
          </>
        )}
        <span className={styles.pocket}>
          <i className={styles.pocketLine} />
        </span>
      </span>
    );
  }

  if (variant === "section") {
    if (empty || sample.length === 0) {
      return (
        <span className={`${box} ${styles.section}`} aria-hidden="true">
          <span className={`${styles.card} ${styles.front} ${styles.sectionGhost}`} />
        </span>
      );
    }
    return (
      <span className={`${box} ${styles.section}`} aria-hidden="true">
        <MiniCard file={sample[1]} className={styles.back1} />
        <MiniCard file={sample[2]} className={styles.back2} />
        <MiniCard file={sample[0]} className={styles.front} />
        {/* Story 4.5: a video on the front card gets the play mark, like the file variant. */}
        {sample[0]?.kind === "video" ? <VideoMark /> : null}
      </span>
    );
  }

  // variant === "file"
  const kind = file?.kind || "";
  const isDoc = kind === "document";
  const isVideo = kind === "video";
  const ext = extLabel(file?.extension);
  return (
    <span className={`${box} ${styles.single}`} aria-hidden="true">
      <MiniCard file={file as RepFile} className={styles.front} isDoc={isDoc} />
      {isVideo ? <VideoMark /> : null}
      {isDoc && ext ? <span className={`spine-display-sticker ${styles.docExt}`}>{ext}</span> : null}
    </span>
  );
}
