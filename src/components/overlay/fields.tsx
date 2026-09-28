"use client";

/**
 * Story 3.1 — isian baku lapisan: `radio-card`, `info-note`,
 * `one-time-secret`. Dibangun DI SINI sebagai satu-satunya sumbernya;
 * Admin Panel (Story 3.18/3.19) dan `share-modal` (Story 3.8)
 * mengonsumsinya, tidak membangunnya ulang.
 */

import React, { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import styles from "./overlay.module.css";
import { PillButton } from "@/components/form/buttons";

/* ------------------------------------------------------------------ */
/* radio-card                                                          */
/* ------------------------------------------------------------------ */

export type RadioCardOption<T extends string> = {
  value: T;
  title: React.ReactNode;
  note?: React.ReactNode;
  /** Ikon garis 18px di depan judul (`share-modal` Mode akses, Story 3.8). */
  icon?: React.ReactNode;
};

export type RadioCardGroupProps<T extends string> = {
  /** Label grup, mis. "Cara membuat password". */
  label: string;
  options: RadioCardOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * `stack` (bawaan) = kartu bertumpuk.
   * `row` = kartu SEBARIS dengan lebar sama — "Mode akses" (2 kolom) dan
   *   "Kedaluwarsa" (3 kolom) di `share-modal` (Story 3.8).
   */
  layout?: "stack" | "row";
  /**
   * Baris yang BERTUMPUK di HP (kartu 56px) — "Mode akses". "Kedaluwarsa"
   * tidak memakainya: tiga kartunya tetap sebaris di HP (AC 3.8).
   */
  stackOnMobile?: boolean;
  /** Kartu ringkas: hanya titik + judul di tengah, tanpa kalimat arti. */
  compact?: boolean;
  /** Elemen yang menjelaskan grup ini (kalimat jam absolut). */
  describedBy?: string;
  className?: string;
};

/**
 * Kartu pilihan 52 px di dalam `radiogroup` berlabel. Panah atas/bawah
 * (dan kiri/kanan) berpindah pilihan seperti radio asli; hanya kartu
 * terpilih yang masuk urutan Tab (roving tabindex).
 */
export function RadioCardGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  layout = "stack",
  stackOnMobile = false,
  compact = false,
  describedBy,
  className,
}: RadioCardGroupProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  const move = (delta: number) => {
    const next = (index + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      className={`${styles.radioGroup} ${layout === "row" ? styles.radioGroupRow : ""} ${
        compact ? styles.radioGroupCompact : ""
      } ${stackOnMobile ? styles.radioGroupStackMobile : ""} ${className ?? ""}`}
    >
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (index === 0 && i === 0 && !options.some((o) => o.value === value)) ? 0 : -1}
            className={`spine-focus-ring ${styles.radioCard} ${compact ? styles.radioCardCompact : ""}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                move(-1);
              }
            }}
          >
            <span className={styles.radioDot} aria-hidden="true" />
            {option.icon ? (
              <span className={styles.radioIcon} aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            <span className={styles.radioText}>
              <span className={`spine-body ${styles.radioTitle}`}>{option.title}</span>
              {option.note ? (
                <span className={`spine-footnote ${styles.radioNote}`}>{option.note}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* info-note                                                           */
/* ------------------------------------------------------------------ */

export type InfoNoteProps = {
  variant?: "neutral" | "warn";
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

const NEUTRAL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </svg>
);

const WARN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M12 3.6 2.6 20h18.8L12 3.6z" />
    <path d="M12 10v4.4M12 17.6v.01" />
  </svg>
);

/**
 * Selalu dengan KALIMAT lengkap — keadaan tidak pernah disampaikan lewat
 * warna saja (NFR15). Ikon `aria-hidden`.
 */
export function InfoNote({ variant = "neutral", icon, children, className }: InfoNoteProps) {
  return (
    <div
      className={`spine-body-sm ${styles.note} ${variant === "warn" ? styles.noteWarn : ""} ${className ?? ""}`}
    >
      {icon ?? (variant === "warn" ? WARN_ICON : NEUTRAL_ICON)}
      <span>{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* one-time-secret                                                     */
/* ------------------------------------------------------------------ */

export type OneTimeSecretProps = {
  secret: string;
  /** Nama aksesibel tombol salin. */
  copyLabel?: string;
  className?: string;
};

/**
 * Field 56 px berhuruf `display-secret` bertracking lebar, `user-select:
 * all`, dengan tombol "Salin" → "Tersalin" varian ok. Dialog yang memuat
 * komponen ini memakai `dismissOnBackdrop={false}` (rahasia sekali tampil
 * tidak boleh hilang karena klik tak sengaja) — lihat `Dialog`.
 */
export function OneTimeSecret({ secret, copyLabel, className }: OneTimeSecretProps) {
  const t = useTranslations("fields");
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const fieldId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setState("done");
      window.setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("failed");
    }
  };

  return (
    <div className={className}>
      <div className={styles.secretRow}>
        <code id={fieldId} className={`spine-display-secret ${styles.secretField}`}>
          {secret}
        </code>
        <PillButton
          variant="surface"
          aria-label={copyLabel ?? t("copyPassword")}
          className={`${styles.secretCopy} ${state === "done" ? styles.secretCopyDone : ""}`}
          onClick={copy}
        >
          {state === "done" ? t("copied") : t("copy")}
        </PillButton>
      </div>
      <p className="spine-visually-hidden" role="status">
        {state === "done" ? t("passwordCopied") : ""}
      </p>
      {state === "failed" ? (
        <p className={`spine-footnote ${styles.secretFail}`} role="alert">
          {t("copyFailed")}
        </p>
      ) : null}
    </div>
  );
}
