"use client";

/**
 * Story 3.16 — `chat-composer`.
 *
 * Pill 48 px + tombol kirim 48 px, dipakai panel Diskusi project
 * (Story 3.17), Chat Monitor (Story 3.24), dan pipeline
 * (Story 3.30). Satu komponen; permukaan yang belum punya "@" cukup
 * TIDAK mengoper `mentions` dan dropdown-nya tidak pernah dirender.
 *
 * Kontrak:
 *  - tombol kirim abu saat kosong (`aria-disabled="true"`), kuning saat
 *    ada isi, spinner saat mengirim (`aria-busy="true"`);
 *  - urutan Tab mengikuti urutan baca: lampiran → input → kirim;
 *  - Enter mengirim, KECUALI saat dropdown mention terbuka — di sana
 *    Enter memilih dan tidak mengirim (AC 3.16);
 *  - Esc menutup dropdown dan teks tetap.
 */

import React, { useId, useRef, useState } from "react";
import styles from "./chat.module.css";
import { MentionDropdown, MENTION_LIMIT, type MentionOption } from "./MentionDropdown";

const SEND_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export type ChatComposerProps = {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  /** Nama aksesibel kolom tulis. */
  label?: string;
  sendLabel?: string;
  busy?: boolean;
  /** Kolom tulis dimatikan (riwayat gagal dimuat — AC 3.17). */
  disabled?: boolean;
  /**
   * Tray lampiran di atas baris tulis. Kosong di gelombang ini untuk
   * panel Diskusi project (FR28 jatuh di Story 4.3) — slotnya sudah ada
   * supaya pemasangannya nanti tidak mengubah tata letak.
   */
  attachments?: React.ReactNode;
  /**
   * Hasil mention. Tanpa prop ini permukaan berjalan TANPA "@" sama
   * sekali: tidak ada `role="combobox"`, tidak ada dropdown.
   */
  mentions?: {
    /** Kata setelah "@" yang sedang dicari. */
    query: string;
    options: MentionOption[];
    onPick: (option: MentionOption) => void;
    onDismiss: () => void;
  } | null;
  /** Kalimat bantu di bawah baris tulis. */
  hint?: React.ReactNode;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  className?: string;
};

export function ChatComposer({
  value,
  onChange,
  onSend,
  placeholder,
  label = "Tulis pesan",
  sendLabel = "Kirim",
  busy = false,
  disabled = false,
  attachments,
  mentions = null,
  hint,
  inputRef,
  className,
}: ChatComposerProps) {
  const uid = useId();
  const listId = `${uid}-mentions`;
  const optionIdPrefix = `${uid}-mention`;
  const [activeIndex, setActiveIndex] = useState(0);
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;

  const options = mentions ? mentions.options.slice(0, MENTION_LIMIT) : [];
  const open = Boolean(mentions && options.length > 0);
  const empty = value.trim().length === 0;

  // Daftar berganti → sorotan kembali ke baris pertama.
  React.useEffect(() => {
    setActiveIndex(0);
  }, [mentions?.query, options.length]);

  const send = () => {
    if (busy || disabled || empty) return;
    onSend();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Enter") {
        // MEMILIH, tidak mengirim.
        e.preventDefault();
        mentions?.onPick(options[activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        // Menutup dropdown; teks TETAP. `stopPropagation` supaya Esc tidak
        // ikut menutup lapisan di atasnya (aturan satu tingkat per tekan).
        e.preventDefault();
        e.stopPropagation();
        mentions?.onDismiss();
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    }
  };

  const sendState = busy ? styles.sendBusy : empty || disabled ? styles.sendOff : "";

  return (
    <div className={`${styles.composer} ${className ?? ""}`}>
      {attachments ? <div className={styles.tray}>{attachments}</div> : null}
      {open ? (
        <MentionDropdown
          listId={listId}
          optionIdPrefix={optionIdPrefix}
          options={options}
          activeIndex={activeIndex}
          onPick={(o) => mentions?.onPick(o)}
          query={mentions?.query ?? ""}
        />
      ) : null}
      <div className={styles.row}>
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={label}
          aria-disabled={disabled || undefined}
          readOnly={disabled}
          {...(mentions
            ? {
                role: "combobox" as const,
                "aria-expanded": open,
                "aria-controls": open ? listId : undefined,
                "aria-activedescendant": open ? `${optionIdPrefix}-${activeIndex}` : undefined,
                "aria-autocomplete": "list" as const,
              }
            : {})}
          className={`spine-focus-ring ${styles.input}`}
        />
        <button
          type="button"
          aria-label={sendLabel}
          aria-disabled={empty || disabled || undefined}
          aria-busy={busy || undefined}
          className={`spine-focus-ring ${styles.send} ${sendState}`}
          onClick={send}
        >
          {busy ? <span className={styles.spinner} aria-hidden="true" /> : SEND_ICON}
        </button>
      </div>
      {/* Mode kalem: spinner berhenti berputar, jadi keadaannya harus tetap
          TERTULIS — kalimat status ini yang membawanya (AC 3.16). */}
      <p className="spine-visually-hidden" role="status">
        {busy ? "Mengirim pesan…" : ""}
      </p>
      {hint ? <p className={`spine-footnote ${styles.hint}`}>{hint}</p> : null}
    </div>
  );
}
