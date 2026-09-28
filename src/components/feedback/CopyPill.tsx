"use client";

/**
 * Story 3.2 — `copy-pill`, satu-satunya sumbernya untuk seluruh app.
 * Dikonsumsi `share-modal` (Story 3.8), halaman Shared (Story 3.22), dan
 * bagian "Link aktif" (Epic 4). Jangan dibangun ulang per layar.
 *
 * Kontrak keras:
 *  - SATU `<button>` utuh: seluruh permukaannya menyalin.
 *  - Yang disalin selalu TAUTAN PENUH (skema + host), bukan potongan
 *    yang tampil di layar.
 *  - Nama aksesibel "Salin tautan /s/{slug}".
 *  - Berhasil → `toast` "Link disalin ke clipboard!" (`role="status"`).
 *    Ditolak browser → kalimat manual, alamat tetap bisa diblok.
 */

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./copyPill.module.css";
import { useToast } from "./ToastProvider";

const COPY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M6 15H5.5A1.5 1.5 0 0 1 4 13.5V5.5A1.5 1.5 0 0 1 5.5 4h8A1.5 1.5 0 0 1 15 5.5V6" />
  </svg>
);

/** Ekor yang selalu dipertahankan saat alamat dipotong di tengah. */
const TAIL_CHARS = 5;

/** Path prefix of a share link; shown as is, not copy. */
const SHARE_PREFIX = "/s/";

export type CopyPillProps = {
  /** Slug tanpa "/s/". */
  slug: string;
  /**
   * Tautan penuh yang DISALIN. Bila kosong dirakit dari `window.location.origin`
   * pada saat klik — bukan saat render, supaya SSR tidak menebak host.
   */
  href?: string;
  size?: "default" | "large";
  /**
   * Kontrol tambahan yang memakai SATU sumber salin yang sama dengan pill —
   * `button-primary` "Salin Tautan" di kotak hasil `share-modal` (Story 3.8).
   * Dirender di bawah pill, di atas kalimat cadangan manual.
   */
  action?: (copy: () => void, manual: boolean) => React.ReactNode;
  className?: string;
};

export function CopyPill({ slug, href, size = "default", action, className }: CopyPillProps) {
  const { pushToast } = useToast();
  const t = useTranslations("copyPill");
  const [manual, setManual] = useState(false);

  const shown = `${SHARE_PREFIX}${slug}`;
  const head = slug.length > TAIL_CHARS ? slug.slice(0, slug.length - TAIL_CHARS) : slug;
  const tail = slug.length > TAIL_CHARS ? slug.slice(slug.length - TAIL_CHARS) : "";

  const copy = async () => {
    const full = href ?? `${window.location.origin}${shown}`;
    try {
      // Sebagian browser MENGGANTUNG janji clipboard (izin ditolak diam-diam,
      // tab tidak fokus) alih-alih menolaknya. Tanpa batas waktu pengguna
      // tidak mendapat umpan balik apa pun — bukan toast, bukan kalimat
      // manual. 1,5 detik dihitung sebagai penolakan.
      await Promise.race([
        navigator.clipboard.writeText(full),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("clipboard-timeout")), 1500);
        }),
      ]);
      setManual(false);
      pushToast({ tone: "success", message: t("copied") });
    } catch {
      setManual(true);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        aria-label={t("copyLink", { path: shown })}
        className={`spine-focus-ring spine-hit-area ${styles.pill} ${size === "large" ? styles.large : ""}`}
        onClick={copy}
      >
        <span className={styles.addr}>
          <span className={`spine-nav ${styles.scheme}`}>{SHARE_PREFIX}</span>
          <span className={`${size === "large" ? "spine-display-secret" : "spine-nav"} ${styles.head}`}>
            {head}
          </span>
          {tail ? (
            <span className={`${size === "large" ? "spine-display-secret" : "spine-nav"} ${styles.tail}`}>
              {tail}
            </span>
          ) : null}
        </span>
        <span className={styles.icon} aria-hidden="true">
          {COPY_ICON}
        </span>
      </button>
      {action ? action(copy, manual) : null}
      {manual ? (
        <p className={`spine-footnote ${styles.fallback}`} role="alert">
          {t("copyFailed")}
        </p>
      ) : null}
    </div>
  );
}
