// Story 1.27: success-mark: accent tile with a white check, 72px, rotated −6° untuk layar
// selesai (AC epics.md 1.27; mock key-forgot-password.html .done-mark).
// TANPA animasi apa pun (tanpa stickerPop); ikon aria-hidden; selalu
// didampingi judul + kalimat di pemakainya. Server-safe (tanpa 'use client').
import styles from './Marks.module.css';

export type SuccessMarkProps = { className?: string };

export default function SuccessMark({ className }: SuccessMarkProps) {
  return (
    <div className={[styles.mark, styles.success, className].filter(Boolean).join(' ')}>
      {/* Centang mock: 36px, stroke 3.4 (lebih tebal dari ikon UI biasa). */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </div>
  );
}
