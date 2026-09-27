import type { ReactNode } from 'react';
import TagPill from '../tag-pill/TagPill';
import styles from './auth.module.css';

// Story 1.20: kotak auth + slot bernama. Kartu HANYA kotak + jarak +
// urutan slot; ISI slot milik story pemiliknya (auth-tabs → slot-tabs,
// form → slot-form, button-google → slot-alt, pairing-slot → slot-pairing).
// Slot tanpa isi TIDAK dirender sama sekali — tanpa wadah/pemisah/ruang
// kosong, kartu tetap rapat (`.slot + .slot` hanya memberi jarak antar
// slot yang benar-benar tampil). slot-head milik kartu sendiri: judul
// bawaan "Studio Access" + tag-pill "TIM & MITRA" + sub.
// Story 1.28: layar reset password memakai kartu yang sama TANPA pill dan
// tanpa sub (pill={null}, subtitle={null}); layar selesai (1.31) butuh
// kepala sendiri (success-mark + judul hero) → prop `head` menggantikan
// kepala bawaan seluruhnya.
export default function AuthCard({
  tabs,
  form,
  alt,
  help,
  pairing,
  title = 'Studio Access',
  titleLang,
  titleAs = 'h2',
  subtitle = 'Masuk dan lanjutkan kerjamu.',
  pill = <TagPill>TIM &amp; MITRA</TagPill>,
  head,
}: {
  tabs?: ReactNode;
  form?: ReactNode;
  alt?: ReactNode;
  help?: ReactNode;
  pairing?: ReactNode;
  title?: string;
  /** Bahasa judul — mis. 'en' untuk "Create Account" (Story 1.21). */
  titleLang?: string;
  /** Tag judul: 'h1' untuk layar yang tak punya h1 lain (layar reset,
   * review hunter G3); default 'h2' seperti halaman masuk. */
  titleAs?: 'h1' | 'h2';
  subtitle?: string | null;
  /** Isi pill di baris judul; null = tanpa pill (layar reset). */
  pill?: ReactNode;
  /** Menggantikan slot-head bawaan seluruhnya (layar selesai, Story 1.31). */
  head?: ReactNode;
}) {
  const HeadTag = titleAs;
  return (
    <div className={styles.card}>
      {tabs != null && (
        <div className={styles.slot} data-slot="tabs">
          {tabs}
        </div>
      )}
      {head != null ? (
        <div className={styles.slot} data-slot="head">
          {head}
        </div>
      ) : (
        <div className={`${styles.slot} ${styles.head}`} data-slot="head">
          <div className={styles.headRow}>
            <HeadTag className={`spine-display-panel ${styles.title}`} lang={titleLang}>
              {title}
            </HeadTag>
            {pill != null && pill}
          </div>
          {subtitle != null && (
            <p className={`spine-body-sub ${styles.subtitle}`}>{subtitle}</p>
          )}
        </div>
      )}
      {form != null && (
        <div className={styles.slot} data-slot="form">
          {form}
        </div>
      )}
      {alt != null && (
        <div className={styles.slot} data-slot="alt">
          {alt}
        </div>
      )}
      {help != null && (
        <div className={styles.slot} data-slot="help">
          {help}
        </div>
      )}
      {pairing != null && (
        <div className={styles.slot} data-slot="pairing">
          {pairing}
        </div>
      )}
    </div>
  );
}
