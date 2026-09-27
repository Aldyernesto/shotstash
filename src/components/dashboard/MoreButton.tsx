"use client";

import React from "react";
import styles from "./MoreButton.module.css";

export type MoreButtonVariant = "object" | "in-caption";

export type MoreButtonProps = {
  /** Nama item — tombolnya bernama "Aksi untuk {nama}". */
  itemName: string;
  /**
   * `object` = Kartu Project / Kartu Section: lingkaran 40 px berlatar
   * `{colors.label-pill}`, glyph `{colors.object-text}`, fokus on-photo.
   * `in-caption` = `file-card` & baris daftar: 32 px tanpa latar, ikon
   * 18 px `{colors.muted}`, di ujung baris nama.
   */
  variant?: MoreButtonVariant;
  expanded?: boolean;
  className?: string;
  /** Menerima anchor tombol supaya menu terbuka TEPAT di tombol "⋯". */
  onOpen: (anchor: { x: number; y: number }) => void;
};

/**
 * Tombol "⋯" (Story 2.12) — jalur pembuka menu aksi yang setara untuk
 * sentuh dan pointer. Yang dibukanya adalah `ContextMenu` yang SUDAH ada
 * dengan item yang sama persis dengan klik-kanan hari ini; redesain menu
 * (`menu-popover` / sheet HP) adalah FR20 / Epic 3, bukan di sini.
 *
 * Selalu SIBLING DI ATAS tautan kartu, tidak pernah di dalamnya.
 */
export default function MoreButton({
  itemName,
  variant = "object",
  expanded = false,
  className,
  onOpen,
}: MoreButtonProps) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-label={`Aksi untuk ${itemName}`}
      className={`${variant === "object" ? "spine-focus-ring--on-photo" : "spine-focus-ring"} spine-hit-area ${
        styles.button
      } ${variant === "object" ? styles.object : styles.inCaption} ${className ?? ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onOpen({ x: rect.left, y: rect.bottom + 4 });
      }}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="19" cy="12" r="2" />
      </svg>
    </button>
  );
}
