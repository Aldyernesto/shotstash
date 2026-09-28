/* ATURAN PEMAKAIAN button-danger — jangan dilanggar di layar mana pun:
   - variant="outline": konfirmasi kontekstual di dalam baris / kartu /
     bar aksi (Restore, Tolak akses, Batalkan sesi) — latar transparan.
   - variant="solid": HANYA konfirmasi permanen yang tidak berulang di
     layar yang sama (hancurkan Project, kosongkan Trash) — latar
     --app-danger-solid.
   - "Move to Trash" dan "Restore" TIDAK PERNAH solid merah — keduanya
     the accent ButtonPrimary (a guard against accidental deletes).
   (Story 1.14; komponen dibangun di sini, layar Epic 2/3 mengonsumsi.) */

// Story 1.14: keluarga tombol — ButtonPrimary, PillButton, ButtonDanger,
// TextLink. Semua radius penuh (pill), semua dengan focus-ring Story 1.7.
import Link from 'next/link';
import styles from './buttons.module.css';

// ButtonPrimary — aksi utama form/layar. Klik ganda saat memproses
// DIABAIKAN lewat aria-disabled + aria-busy (Bukan atribut disabled —
// fokus tidak boleh hilang dari tombol; label berganti "Memproses..." dsb.),
// spinner hanya di tombol yang sedang memproses (tetap berputar di mode
// kalem lewat .spine-motion-keep — ini umpan balik proses, bukan hiasan).
export type ButtonPrimaryProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: React.ReactNode;
  busy?: boolean;
  /** Label saat busy ("Memproses...", "Mengirim...", dst. per layar). */
  busyLabel?: string;
  /** Panah → di kanan label (default tampil, hilang saat busy). */
  arrow?: boolean;
};

export function ButtonPrimary({
  busy = false,
  busyLabel,
  arrow = true,
  className,
  onClick,
  type = 'submit',
  children,
  ...rest
}: ButtonPrimaryProps) {
  return (
    <button
      {...rest}
      type={type}
      data-busy={busy || undefined}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
      className={`spine-focus-ring spine-display-button ${styles.btnPrimary} ${className ?? ''}`}
    >
      <span>{busy ? (busyLabel ?? children) : children}</span>
      {arrow && !busy ? (
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
      ) : null}
      {busy ? (
        <span className={`spine-motion-keep ${styles.spinner}`} aria-hidden="true" />
      ) : null}
    </button>
  );
}

// PillButton — aksi sekunder/ketiga (filter, aksi kartu, navigasi lembut).
// React 19: `ref` adalah prop biasa, jadi ComponentProps<'button'> sudah
// memuatnya dan `{...rest}` meneruskannya. Dipakai Story 3.1 supaya dialog
// bisa menaruh fokus awal di tombol "Batal".
export type PillButtonProps = React.ComponentProps<'button'> & {
  variant?: 'accent' | 'paper' | 'surface';
  /**
   * Sedang memproses: `aria-busy` + `aria-disabled` (BUKAN `disabled` —
   * fokus tidak boleh hilang), kiriman kedua diabaikan, spinner ink.
   * Aturan yang sama dengan ButtonPrimary; dipakai footer `share-modal`
   * (Story 3.8) & `upload-panel` (Story 3.12) yang aksinya pill 48px.
   */
  busy?: boolean;
  busyLabel?: React.ReactNode;
};

export function PillButton({
  variant = 'surface',
  busy = false,
  busyLabel,
  className,
  type = 'button',
  onClick,
  children,
  ...rest
}: PillButtonProps) {
  const variantClass =
    variant === 'accent' ? styles.pillAccent : variant === 'paper' ? styles.pillPaper : styles.pillSurface;
  return (
    <button
      {...rest}
      type={type}
      data-busy={busy || undefined}
      aria-busy={busy || undefined}
      aria-disabled={busy || rest['aria-disabled'] || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
      className={`spine-focus-ring spine-button ${styles.pill} ${variantClass} ${className ?? ''}`}
    >
      {busy ? (
        <>
          <span className={`spine-motion-keep ${styles.spinner}`} aria-hidden="true" />
          <span>{busyLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

// ButtonDanger — lihat ATURAN PEMAKAIAN di atas berkas.
export type ButtonDangerProps = React.ComponentProps<'button'> & {
  variant?: 'outline' | 'solid';
};

export function ButtonDanger({
  variant = 'outline',
  className,
  type = 'button',
  children,
  ...rest
}: ButtonDangerProps) {
  return (
    <button
      {...rest}
      type={type}
      className={`spine-focus-ring spine-button ${
        variant === 'solid' ? styles.dangerSolid : styles.dangerOutline
      } ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

// TextLink — tautan teks dalam kalimat/form ("Lupa password?",
// "Ganti email", "Kembali ke halaman masuk"). Dark: text color + a 2px accent
// underline, offset 4px. Light: text AND underline in accent-text-light.
export type TextLinkProps = React.ComponentProps<typeof Link>;

export function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <Link className={`spine-link ${styles.textLink} ${className ?? ''}`} {...rest}>
      {children}
    </Link>
  );
}
