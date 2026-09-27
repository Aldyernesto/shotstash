'use client';

// Story 1.26: code-input enam kotak untuk kode verifikasi reset password
// (AC epics.md 1.26; mock key-forgot-password.html .code i).
// - Kirim otomatis di karakter ke-6: ketik yang MENGISI kotak terakhir,
//   tempel, dan autofill. Mengetik di atas kode yang SUDAH penuh (membetulkan
//   satu huruf setelah ditolak) TIDAK mengirim ulang — percobaan server
//   terbatas (5 kali); kirim ulang lewat tombol "Verifikasi Kode".
// - Server menolak kode → prop `invalid` (border danger semua kotak, isi
//   dipertahankan) dan fokus kembali ke kotak terisi terakhir; kegagalan
//   transport fokusnya dijadwalkan parent via ref focusLastFilled()/focusAt()
//   (fokus tak bisa masuk input yang masih disabled selama memeriksa).
// - Hint "Kode diperiksa otomatis…" dirender komponen di atas kotak dan
//   terhubung aria-describedby dari tiap kotak.
// Charset & panjang mengikuti server (password-reset.service.ts):
// tanpa I, L, O, 0, 1. — SATU sumber klien; shared.tsx me-re-ekspor.

import { useEffect, useId, useImperativeHandle, useRef } from 'react';
import styles from './CodeInput.module.css';

export const CODE_LENGTH = 6;
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Kode utuh yang berdiri sendiri di teks tempelan (mis. "Kode: AB3XYZ"),
// huruf besar/kecil sama. Tempel tidak pernah diblokir: token utuh dipakai,
// sisanya disaring ke karakter yang valid.
const STANDALONE_CODE = new RegExp(`\\b[${CODE_ALPHABET}]{${CODE_LENGTH}}\\b`, 'i');

/** Pakai kode utuh yang berdiri sendiri kalau ada; selain itu ambil karakter kode yang valid saja. */
function cleanCode(value: string): string {
  const standalone = value.match(STANDALONE_CODE)?.[0];
  if (standalone) return standalone.toUpperCase();
  return value
    .toUpperCase()
    .split('')
    .filter((ch) => CODE_ALPHABET.includes(ch))
    .join('');
}

export type CodeInputHandle = {
  /** Fokus ke kotak terisi terakhir (kotak pertama bila kosong semua). */
  focusLastFilled: () => void;
  /** Fokus ke kotak pada indeks tertentu (mis. kotak pertama setelah CODE_LOCKED). */
  focusAt: (index: number) => void;
};

export type CodeInputProps = {
  value: string[];
  onChange: (next: string[]) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  /** Server menolak kode: semua kotak border danger, isi dipertahankan. */
  invalid?: boolean;
  ref?: React.Ref<CodeInputHandle>;
};

export default function CodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  ref,
}: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const hintId = useId();

  const focusBox = (index: number) => {
    const el = refs.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))];
    el?.focus();
    el?.select();
  };

  const focusLastFilled = () => {
    let last = -1;
    for (let i = 0; i < CODE_LENGTH; i++) if (value[i]) last = i;
    focusBox(last === -1 ? 0 : last);
  };

  useImperativeHandle(ref, () => ({ focusLastFilled, focusAt: focusBox }));

  // Server menolak kode → fokus kembali ke kotak terisi terakhir (AC 1.26).
  // Efek (bukan pemanggilan langsung) supaya fokusnya jatuh SETELAH commit
  // yang melepas disabled — fokus ke input disabled adalah no-op.
  useEffect(() => {
    if (invalid) focusLastFilled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalid]);

  // Isi beberapa karakter sekaligus mulai dari `start` (tempel / isi otomatis).
  // Tempel & autofill selalu boleh mengirim saat penuh — niatnya jelas satu kode.
  const fill = (start: number, chars: string) => {
    const next = [...value];
    const from = chars.length >= CODE_LENGTH ? 0 : start;
    for (let i = 0; i < chars.length && from + i < CODE_LENGTH; i++) next[from + i] = chars[i];
    onChange(next);
    settle(next, from + chars.length, true);
  };

  // Isi satu karakter lalu auto-advance — atau kirim otomatis bila kotak
  // terakhir BARU saja terisi (AC 1.26: kirim otomatis juga untuk kode yang
  // DIKETIK, bukan hanya tempelan).
  const setChar = (index: number, ch: string) => {
    const next = [...value];
    next[index] = ch;
    onChange(next);
    settle(next, index + 1, value.some((c) => !c));
  };

  /** Setelah nilai berubah: kirim bila penuh, selain itu lanjut ke kotak berikutnya. */
  const settle = (next: string[], nextCursor: number, maySubmit: boolean) => {
    const empty = next.findIndex((ch) => !ch);
    if (empty === -1) {
      if (maySubmit) {
        refs.current[CODE_LENGTH - 1]?.blur();
        onComplete(next.join(''));
      }
    } else if (nextCursor < CODE_LENGTH) {
      focusBox(nextCursor);
    }
  };

  return (
    <div className={styles.wrap}>
      <p id={hintId} className={`spine-footnote ${styles.hint}`}>
        Kode diperiksa otomatis setelah 6 karakter.
      </p>
      <div className={`${styles.row} ${invalid ? styles.rowInvalid : ''}`} role="group" aria-label="Kode 6 karakter">
        {value.map((ch, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className={`spine-display-code spine-focus-ring ${styles.box}`}
            value={ch}
            disabled={disabled}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            spellCheck={false}
            aria-label={`Karakter ke-${i + 1} dari ${CODE_LENGTH}`}
            aria-invalid={invalid || undefined}
            aria-describedby={hintId}
            onFocus={(e) => e.target.select()}
            onPaste={(e) => {
              e.preventDefault();
              const chars = cleanCode(e.clipboardData.getData('text'));
              if (chars) fill(i, chars);
            }}
            onChange={(e) => {
              const raw = e.target.value;
              const chars = cleanCode(raw);
              if (!chars) {
                // Karakter tidak valid (mis. O/0/I/1/L) diabaikan; kotak dikosongkan kalau isinya dihapus.
                if (!raw) {
                  const next = [...value];
                  next[i] = '';
                  onChange(next);
                }
                return;
              }
              if (chars.length === 1) {
                setChar(i, chars);
                return;
              }
              // Autofill keyboard menggabungkan isi lama + karakter baru di
              // kotak yang sudah terisi → ambil karakter terakhir saja.
              if (chars.length === 2 && ch) {
                setChar(i, chars.replace(ch, '') || chars[1]);
                return;
              }
              // Kode penuh ditempel ke kotak yang sudah terisi → buang karakter lama dulu.
              fill(i, ch && chars.length === CODE_LENGTH + 1 ? chars.replace(ch, '') : chars);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !value[i] && i > 0) {
                e.preventDefault();
                const next = [...value];
                next[i - 1] = '';
                onChange(next);
                focusBox(i - 1);
              } else if (e.key === 'ArrowLeft' && i > 0) {
                e.preventDefault();
                focusBox(i - 1);
              } else if (e.key === 'ArrowRight' && i < CODE_LENGTH - 1) {
                e.preventDefault();
                focusBox(i + 1);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
