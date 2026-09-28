// Story 1.15: form-alert — pesan satu kalimat di ATAS tombol utama form.
// - danger: role="alert" (diumumkan agresif); ok: role="status" (sopan).
// - Ikon 18px + kalimat spine-body-sm, gap 10px, padding 12px 14px,
//   radius md; pasangan warna danger/ok dari spine (*-bg / *-border /
//   *-text, dengan pasangan -light di tema terang).
// - Kalimat selalu lengkap & bisa ditindaklanjuti — bukan kode error mentah.
// NoticeBar = form-alert + tombol tutup ×; saat ditutup fokus kembali ke
// elemen yang aktif sebelum bar muncul. (Dibangun di sini; pemakai di
// Epic 2/3.)
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import styles from './FormAlert.module.css';

export type FormAlertProps = {
  tone?: 'danger' | 'ok';
  id?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

export function FormAlert({ tone = 'danger', id, className, style, children }: FormAlertProps) {
  return (
    <div
      id={id}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`${styles.alert} ${tone === 'danger' ? styles.danger : styles.ok} ${className ?? ''}`}
      style={style}
    >
      {tone === 'danger' ? <AlertIcon /> : <CheckIcon />}
      <span className="spine-body-sm">{children}</span>
    </div>
  );
}

export type NoticeBarProps = FormAlertProps & {
  onClose: () => void;
  /**
   * Accessible name of the × button. Defaults to `form.closeNotice`;
   * callers may pass their own (the Admin Panel does, Story 3.21).
   */
  closeLabel?: string;
};

export function NoticeBar({ onClose, closeLabel: closeLabelProp, ...rest }: NoticeBarProps) {
  const t = useTranslations('form');
  const closeLabel = closeLabelProp ?? t('closeNotice');
  // Fokus kembali ke elemen yang aktif sebelum bar muncul.
  const prevFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    prevFocusRef.current = document.activeElement as HTMLElement | null;
  }, []);
  return (
    <div className={styles.noticeWrap}>
      {/* hasClose: beri padding kanan supaya kalimat tidak berakhir di
          bawah tombol × (temuan review G2). */}
      <FormAlert {...rest} className={`${rest.className ?? ''} ${styles.hasClose}`} />
      <button
        type="button"
        aria-label={closeLabel}
        className={`spine-hit-area spine-focus-ring ${styles.closeBtn}`}
        onClick={() => {
          onClose();
          prevFocusRef.current?.focus?.();
        }}
      >
        ×
      </button>
    </div>
  );
}
