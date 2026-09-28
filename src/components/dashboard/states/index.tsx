"use client";

/**
 * Story 2.8 — `empty-state`, `skeleton-row`, dan `error-box`.
 *
 * Dibangun DI SINI sebagai satu-satunya sumbernya untuk seluruh app:
 * grid Projects sudah membutuhkan ketiganya di gelombang ini. Story
 * lapisan bersama Epic 3 (UX-DR69) MEMPERLUAS berkas ini — varian toast
 * dan varian per layar — dan tidak membangunnya ulang.
 *
 * Aturan keras (AC 2.8): ketiganya tidak punya gerak apa pun, termasuk
 * DI LUAR mode kalem. Tidak ada shimmer pada skeleton. CTA di dalam
 * `empty-state` selalu tombol sibling, bukan kontrol bersarang di dalam
 * tautan — komponen ini merendernya sebagai `<div>` saudara judul, jadi
 * pemanggil tidak bisa keliru menyarangkannya.
 */

import React from "react";
import { useTranslations } from "next-intl";
import styles from "./states.module.css";
import { PillButton } from "@/components/form/buttons";

/* ------------------------------------------------------------------ */
/* empty-state                                                         */
/* ------------------------------------------------------------------ */

export type EmptyStateProps = {
  /**
   * "ghost" = slot hantu bergaris TANPA label (bentuk `project-empty`);
   * "tile"  = tile ikon 56 px miring −6°;
   * "none"  = tanpa objek (judul + kalimat saja).
   */
  variant?: "ghost" | "tile" | "none";
  /** Ikon untuk varian "tile" (SVG 26 px, `aria-hidden` diurus di sini). */
  icon?: React.ReactNode;
  title?: React.ReactNode;
  text?: React.ReactNode;
  /** Tombol CTA — dirender sebagai SIBLING, tidak pernah di dalam tautan. */
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({
  variant = "ghost",
  icon,
  title,
  text,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={`${styles.empty} ${className ?? ""}`}>
      {variant === "ghost" ? <div className={styles.ghost} aria-hidden="true" /> : null}
      {variant === "tile" ? (
        <div className={styles.tile} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      {title ? (
        <p className={`spine-display-panel-mobile ${styles.emptyTitle}`}>{title}</p>
      ) : null}
      {text ? <p className={`spine-body ${styles.emptyText}`}>{text}</p> : null}
      {action ? <div className={styles.emptyAction}>{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* skeleton-row                                                        */
/* ------------------------------------------------------------------ */

export type SkeletonRowProps = {
  /** Jumlah baris siluet. */
  rows?: number;
  /**
   * Story 3.2 (perluasan): `card` = baris `link-row` dengan thumb (wujud
   * Epic 2); `table` = baris tabel/daftar untuk Admin, Shared, Trash, dan
   * chat — tanpa thumb, satu batang per kolom.
   */
  variant?: "card" | "table";
  /** Jumlah kolom siluet untuk varian `table`. */
  columns?: number;
  className?: string;
};

/**
 * Siluet DIAM (tanpa shimmer) di dalam region ber-`aria-busy="true"`.
 * Region-nya dirender di sini supaya pemanggil tidak bisa lupa.
 *
 * Story 3.2 menambahkan "Memuat…" sebagai live region polite yang
 * diumumkan SEKALI — pembaca layar tahu ada yang sedang dimuat tanpa
 * mengeja setiap batang siluet.
 */
export function SkeletonRow({
  rows = 3,
  variant = "card",
  columns = 4,
  className,
}: SkeletonRowProps) {
  const tCommon = useTranslations("common");
  return (
    <div
      className={`${styles.skeletonRegion} ${className ?? ""}`}
      aria-busy="true"
      aria-live="off"
    >
      <p className="spine-visually-hidden" role="status">
        {tCommon("loading")}
      </p>
      {Array.from({ length: rows }, (_, i) =>
        variant === "table" ? (
          <div key={i} className={styles.skeletonTableRow} aria-hidden="true">
            {Array.from({ length: columns }, (_, c) => (
              <div key={c} className={styles.skeletonCell}>
                <div className={styles.skeletonBar} />
              </div>
            ))}
          </div>
        ) : (
          <div key={i} className={styles.skeletonRow} aria-hidden="true">
            <div className={styles.skeletonThumb} />
            <div className={styles.skeletonBars}>
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonBar} />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* error-box                                                           */
/* ------------------------------------------------------------------ */

export type ErrorBoxProps = {
  title?: React.ReactNode;
  /**
   * Kalimat penyebab SINGKAT dalam bahasa manusia. Teks server mentah
   * ("Failed to fetch", "HTTP 502") tidak pernah dioper ke sini.
   */
  text?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /**
   * Story 3.2 (perluasan): `box` = kotak ber-radius (wujud Epic 2);
   * `banner` = pita lebar penuh untuk kepala halaman.
   */
  variant?: "box" | "banner";
  className?: string;
};

export function ErrorBox({
  title,
  text,
  onRetry,
  retryLabel,
  variant = "box",
  className,
}: ErrorBoxProps) {
  const t = useTranslations("states");
  const tCommon = useTranslations("common");
  // Defaults come from messages so callers that omit them stay translated.
  const titleText = title ?? t("errorTitle");
  const retryText = retryLabel ?? tCommon("retry");
  return (
    <div
      className={`${styles.errorBox} ${variant === "banner" ? styles.errorBanner : ""} ${className ?? ""}`}
      role="alert"
    >
      <svg
        className={styles.errorIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.4v.2" />
      </svg>
      <div className={styles.errorBody}>
        <p className={`spine-row-title ${styles.errorTitle}`}>{titleText}</p>
        {text ? <p className={`spine-footnote ${styles.errorText}`}>{text}</p> : null}
        {onRetry ? (
          <div className={styles.errorAction}>
            {/* pill "Coba lagi" dari keluarga tombol Epic 1 (Story 1.14) —
                termasuk focus-ring tunggalnya; tidak dibangun ulang. */}
            <PillButton variant="surface" onClick={onRetry}>
              {retryText}
            </PillButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
