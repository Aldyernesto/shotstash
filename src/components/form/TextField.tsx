// Story 1.13: text-field — satu kontrak field untuk seluruh Shotstash.
// - Label kontrol di ATAS field, KAPITAL (spine-label), jarak label-gap (8px).
// - Isi surface-2, border istirahat 1px input-border, radius md
//   (input-mobile 14px di HP), min-height 52 (48 di HP) via min-height +
//   padding — bukan height tetap, supaya teks tetap bisa membungkus.
// - Fokus: border kuning (ink di tema terang) + focus-ring Story 1.7;
//   caret TETAP native (tanpa caretColor kustom).
// - Error: border danger + pesan di BAWAH field (ikon 15px + kalimat
//   spine-footnote warna danger-text), input diberi aria-invalid +
//   aria-describedby menuju pesan. Fokus ke field invalid pertama
//   ditangani pemanggil form (halaman login).
// Eye button PasswordInput memakai kelas .controlWrap/.hasSuffix/.eyeBtn
// yang sama (komposisi, bukan duplikasi gaya).
import { useId } from 'react';
import styles from './TextField.module.css';

export type TextFieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'className' | 'children'
> & {
  label: string;
  error?: string | null;
  /** Elemen di sisi kanan DALAM field (mis. tombol mata). */
  suffix?: React.ReactNode;
  /** Sembunyikan label visual — untuk screen reader label tetap ada. */
  hideLabel?: boolean;
  /** Ref ke <input> — dipakai form untuk memfokuskan field invalid (Story 1.28). */
  inputRef?: React.Ref<HTMLInputElement>;
  className?: string;
  style?: React.CSSProperties;
};

export default function TextField({
  label,
  error,
  suffix,
  hideLabel,
  inputRef,
  className,
  style,
  ...inputProps
}: TextFieldProps) {
  const autoId = useId();
  const id = inputProps.id ?? autoId;
  const errorId = `${id}-error`;
  // Error id DIGABUNG dengan deskripsi milik pemanggil, bukan menimpa —
  // deskripsi eksternal tetap ada di accessibility tree saat invalid.
  const describedBy =
    [inputProps['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`${styles.field} ${className ?? ''}`} style={style}>
      <label
        className={`spine-label ${styles.label} ${hideLabel ? styles.visuallyHidden : ''}`}
        htmlFor={id}
      >
        {label}
      </label>
      <div className={styles.controlWrap}>
        <input
          {...inputProps}
          id={id}
          ref={inputRef}
          className={`spine-focus-ring ${styles.input} ${suffix ? styles.hasSuffix : ''} ${
            error ? styles.inputError : ''
          }`}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        {suffix ? <div className={styles.suffix}>{suffix}</div> : null}
      </div>
      {error ? (
        <p className={`spine-footnote ${styles.errorText}`} id={errorId}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}
