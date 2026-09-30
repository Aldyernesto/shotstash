import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import AuthCard from '@/components/auth/AuthCard';
import SuccessMark from '@/components/auth/SuccessMark';
import btnStyles from '@/components/form/buttons.module.css';
import styles from '../forgot-password.module.css';

// Langkah 4: selesai (Story 1.31). Server component — TIDAK ada login otomatis
// (AC): user masuk lagi dengan password baru. Kepala kartu digantikan lewat
// slot `head` AuthCard (success-mark + judul hero mock); tombol Masuk bergaya
// primary spine (buttons.module.css) dan mengarah ke halaman masuk.
export default async function PasswordResetDonePage() {
  const t = await getTranslations('forgotPassword.done');
  return (
    <AuthCard
      pill={null}
      head={
        <div className={styles.doneHead}>
          <SuccessMark />
          <h1 className={`spine-display-hero-mobile ${styles.doneTitle}`}>
            {t.rich('title', { sticker: (c) => <span className={styles.sticker}>{c}</span> })}
          </h1>
        </div>
      }
      form={
        <>
          <p className="spine-body-sm">{t('body')}</p>
          <Link href="/" className={`spine-focus-ring spine-display-button ${btnStyles.btnPrimary}`} style={{ width: '100%', marginTop: 16 }}>
            {t('signIn')}
          </Link>
        </>
      }
    />
  );
}
