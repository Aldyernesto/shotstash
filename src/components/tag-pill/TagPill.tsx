import type { ReactNode } from 'react';
import styles from './tag-pill.module.css';

// Story 1.20: pill kuning miring — kepemilikan tunggal (diekstrak dari
// hero Story 1.16, kini dipakai panggung dan slot-head kartu auth).
// Komponen memberi kelas tipografi .spine-tag; mobile mengecil lewat
// module (paritas persis dengan render hero sebelum ekstraksi).
export default function TagPill({ children }: { children: ReactNode }) {
  return <span className={`spine-tag ${styles.pill}`}>{children}</span>;
}
