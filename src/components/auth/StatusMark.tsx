// Story 1.27: status-mark — pengganti emoji ⏳⛔ (dan gembok untuk akun
// terkunci) dengan petak 72px miring −6°, tiga varian (AC epics.md 1.27):
// - waiting  : kuning + jam pasir ink + satu-satunya glow kuning yang
//              diizinkan untuk mark (aturan DESIGN.md #4, globals.css).
// - rejected : pasangan danger semantik + ikon larangan.
// - locked   : surface-2 + border line + gembok gold.
// TANPA animasi; ikon aria-hidden (pola PairingSlot: aria-hidden pada elemen
// ikon, bukan wadah); status TIDAK pernah warna saja — selalu didampingi
// judul + kalimat di pemakainya. Siap untuk /pending + Epic 3.
import styles from './Marks.module.css';

export type StatusMarkVariant = 'waiting' | 'rejected' | 'locked';

export type StatusMarkProps = { variant: StatusMarkVariant; className?: string };

// Switch lengkap atas varian — varian salah ketik jadi error tipe, bukan
// ikon yang diam-diam salah (temuan review G2).
function variantClass(variant: StatusMarkVariant): string {
  switch (variant) {
    case 'waiting':
      return styles.waiting;
    case 'rejected':
      return styles.rejected;
    case 'locked':
      return styles.locked;
  }
}

function WaitingIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="3" x2="18" y2="3" />
      <line x1="6" y1="21" x2="18" y2="21" />
      <path d="M7.5 3v4.2c0 1.4.7 2.7 1.8 3.6l1.2.9c.3.2.3.6 0 .8l-1.2.9c-1.1.9-1.8 2.2-1.8 3.6V21" />
      <path d="M16.5 3v4.2c0 1.4-.7 2.7-1.8 3.6l-1.2.9c-.3.2-.3.6 0 .8l1.2.9c1.1.9 1.8 2.2 1.8 3.6V21" />
    </svg>
  );
}

function RejectedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="5.7" y1="5.7" x2="18.3" y2="18.3" />
    </svg>
  );
}

function LockedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function StatusMark({ variant, className }: StatusMarkProps) {
  return (
    <div className={[styles.mark, variantClass(variant), className].filter(Boolean).join(' ')}>
      {variant === 'waiting' && <WaitingIcon />}
      {variant === 'rejected' && <RejectedIcon />}
      {variant === 'locked' && <LockedIcon />}
    </div>
  );
}
