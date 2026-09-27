"use client";

import React from "react";
import styles from "./SelectCheck.module.css";

export type SelectCheckVariant = "on-photo" | "surface";

export type SelectCheckProps = {
  /** Nama item — checkbox-nya bernama "Pilih {judul}". */
  itemName: string;
  checked: boolean;
  /**
   * `on-photo` = di atas foto (Kartu Section, `file-card`): lingkaran 28 px
   * berlatar `{colors.scrim-60}` + border `{colors.object-text}`, fokus
   * `{components.focus-ring.on-photo}`.
   * `surface` = di atas surface (`list-row`): tanpa scrim, border
   * `{colors.input-border}`, fokus `{components.focus-ring}` biasa, 26 px di HP.
   */
  variant?: SelectCheckVariant;
  /** Kelas tambahan untuk penempatan (inset kartu / sel kolom). */
  className?: string;
  onToggle: (e: React.MouseEvent<HTMLInputElement>) => void;
};

/**
 * `select-check` (Story 2.12) — `<input type="checkbox">` NATIVE yang
 * digambar sebagai lingkaran. Bungkusnya `<label>` supaya seluruh area
 * sentuh (48 px HP / 44 px desktop) benar-benar menyalakan checkbox-nya
 * tanpa mengubah ukuran visual lingkaran.
 *
 * Kartu Project TIDAK PERNAH memakai komponen ini: tingkat Projects memang
 * tidak bisa dipilih-banyak (AC 2.12).
 */
export default function SelectCheck({
  itemName,
  checked,
  variant = "on-photo",
  className,
  onToggle,
}: SelectCheckProps) {
  return (
    <label
      className={`${styles.wrap} ${variant === "surface" ? styles.wrapSurface : ""} ${className ?? ""}`}
      // Klik pada checkbox tidak pernah membuka item: tautan/tombol kartu
      // ada di bawahnya, jadi kliknya dihentikan di sini.
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        className={`${variant === "on-photo" ? "spine-focus-ring--on-photo" : "spine-focus-ring"} ${styles.input} ${
          variant === "surface" ? styles.inputSurface : styles.inputPhoto
        }`}
        checked={checked}
        aria-label={`Pilih ${itemName}`}
        onChange={() => {
          /* keadaan dikendalikan pemanggil lewat onClick (butuh shiftKey). */
        }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(e);
        }}
      />
      <svg className={styles.mark} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </label>
  );
}
