// Story 1.15: status-chip — cap status 28px (ok/danger/warning/netral).
// Titik 7px hanya PENGUAT visual (aria-hidden); label SELALU tertulis —
// warna tidak pernah jadi satu-satunya pembawa arti. Warna teks memakai
// varian *-text (bukan warna isi) di atas latar *-bg; varian netral
// bercincin: surface-2 + border line + teks muted. (Dibangun di sini;
// pemakai termasuk pairing-slot di gelombang ini, Epic 2/3 menyusul.)
// Story 1.24: ikon opsional (mis. pairing-slot) menggantikan titik — tetap
// aria-hidden, label tetap sumber arti; tanpa prop, perilaku lama persis.
import styles from './StatusChip.module.css';

export type StatusChipProps = {
  tone?: 'ok' | 'danger' | 'warning' | 'neutral';
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

const TONE_CLASS: Record<NonNullable<StatusChipProps['tone']>, string> = {
  ok: styles.ok,
  danger: styles.danger,
  warning: styles.warning,
  neutral: styles.neutral,
};

export function StatusChip({ tone = 'neutral', icon, className, children }: StatusChipProps) {
  return (
    <span className={`${styles.chip} ${TONE_CLASS[tone]} ${className ?? ''}`}>
      {icon ? (
        <span className={styles.iconBox} aria-hidden="true">
          {icon}
        </span>
      ) : (
        <span className={styles.dot} aria-hidden="true" />
      )}
      <span className="spine-chip">{children}</span>
    </span>
  );
}
