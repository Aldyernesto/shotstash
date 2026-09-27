import Link from 'next/link';
import AuthCard from '@/components/auth/AuthCard';
import SuccessMark from '@/components/auth/SuccessMark';
import btnStyles from '@/components/form/buttons.module.css';
import styles from '../forgot-password.module.css';

// Langkah 4: selesai (Story 1.31). Server component — TIDAK ada login otomatis
// (AC): user masuk lagi dengan password baru. Kepala kartu digantikan lewat
// slot `head` AuthCard (success-mark + judul hero mock); tombol Masuk bergaya
// primary spine (buttons.module.css) dan mengarah ke halaman masuk.
export default function PasswordResetDonePage() {
  return (
    <AuthCard
      pill={null}
      head={
        <div className={styles.doneHead}>
          <SuccessMark />
          <h1 className={`spine-display-hero-mobile ${styles.doneTitle}`} lang="en">
            WELL <span className={styles.sticker}>DONE!</span>
          </h1>
        </div>
      }
      form={
        <>
          <p className="spine-body-sm">
            Password kamu berhasil diubah. Semua sesi login lama di perangkat lain sudah keluar.
            Silakan masuk dengan password baru.
          </p>
          <Link href="/" className={`spine-focus-ring spine-display-button ${btnStyles.btnPrimary}`} style={{ width: '100%', marginTop: 16 }}>
            Masuk
          </Link>
        </>
      }
    />
  );
}
