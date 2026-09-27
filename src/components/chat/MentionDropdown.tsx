"use client";

/**
 * Story 3.16 — `mention-dropdown`.
 *
 * Menempel DI ATAS komposer, maksimal 6 hasil, tiap baris membawa
 * `project-tag` tipe (PROJECT / SECTION / FILE) + nama + meta.
 *
 * Pola combobox + listbox:
 *   - input pemanggil membawa `role="combobox"`, `aria-expanded`, dan
 *     `aria-activedescendant` (lihat `ChatComposer`),
 *   - panah atas/bawah berpindah,
 *   - Enter MEMILIH dan tidak mengirim,
 *   - Esc menutup dropdown dan teks tetap.
 * Penanganan tombol itu ada di `ChatComposer` karena fokus tetap di
 * input; komponen ini hanya menggambar daftarnya.
 *
 * Belum dipakai panel Diskusi project di gelombang ini — mention "@"
 * jatuh di FR27 (Story 4.3). Dibangun di sini supaya Chat Monitor
 * (Story 3.24) dan worker (Story 3.30) memakai daftar yang sama.
 */

import React from "react";
import styles from "./chat.module.css";
import type { MentionTargetType } from "./chips";

export type MentionOption = {
  id: string;
  type: MentionTargetType;
  name: string;
  /** Keterangan singkat di kanan baris ("72 file", "Video · 02:47"). */
  meta?: string;
};

/** Maksimum hasil yang ditampilkan (AC 3.16). */
export const MENTION_LIMIT = 6;

export type MentionDropdownProps = {
  /** id daftar — dipasang pemanggil di `aria-controls` input. */
  listId: string;
  /** Prefiks id tiap baris — `aria-activedescendant` memakai ini. */
  optionIdPrefix: string;
  options: MentionOption[];
  activeIndex: number;
  onPick: (option: MentionOption) => void;
  /** Kata yang sedang dicari, untuk nama aksesibel daftar. */
  query: string;
};

export function MentionDropdown({
  listId,
  optionIdPrefix,
  options,
  activeIndex,
  onPick,
  query,
}: MentionDropdownProps) {
  const shown = options.slice(0, MENTION_LIMIT);
  if (!shown.length) return null;

  return (
    <div
      id={listId}
      role="listbox"
      aria-label={`Hasil pencarian untuk @${query}`}
      className={styles.drop}
    >
      <p className={`spine-label ${styles.dropHead}`}>
        Sisipkan tag · {shown.length} hasil
      </p>
      {shown.map((option, i) => (
        <button
          key={option.id}
          id={`${optionIdPrefix}-${i}`}
          type="button"
          role="option"
          aria-selected={i === activeIndex}
          tabIndex={-1}
          className={`${styles.dropRow} ${i === activeIndex ? styles.dropRowOn : ""}`}
          // `mousedown` bukan `click`: fokus tidak boleh sempat lepas dari
          // input sebelum pilihan diterapkan.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(option);
          }}
        >
          <span className={`spine-display-sticker ${styles.typeTag}`}>{option.type}</span>
          <span className={styles.dropName}>{option.name}</span>
          {option.meta ? (
            <span className={`spine-footnote ${styles.dropMeta}`}>{option.meta}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
