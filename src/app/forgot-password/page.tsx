'use client';

// Langkah 1: minta kode reset (Story 1.28). Respons server selalu seragam
// (tidak membocorkan email terdaftar); error unik hanya UNAVAILABLE,
// RATE_LIMITED, dan INVALID_EMAIL (invalid → error di bawah kolom email).

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { brand } from '@/lib/brand';
import TextField from '@/components/form/TextField';
import styles from './forgot-password.module.css';
import { ButtonPrimary } from '@/components/form/buttons';
import { FormAlert } from '@/components/form/FormAlert';
import {
  BackToLogin,
  LoadingCard,
  RESET_CODE_LENGTH,
  ResetCard,
  UnavailableNotice,
  isTransportError,
  markCodeSent,
  requestPasswordReset,
  resetErrorMessage,
  usePasswordResetAvailability,
} from './shared';

// Cukup untuk menangkap salah ketik jelas; keputusan final tetap milik server.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RequestResetForm() {
  const t = useTranslations('forgotPassword');
  const router = useRouter();
  const searchParams = useSearchParams();
  const availability = usePasswordResetAvailability();
  const [email, setEmail] = useState(() => searchParams.get('email') ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  // Pengaman kirim-ganda tingkat form (paritas langkah 2/3 — review hunter G3):
  // Enter di input (implicit submission) tidak selalu men-klik tombol, jadi
  // guard busy tombol saja tidak cukup. Ref, bukan state, agar bebas closure basi.
  const submittingRef = useRef(false);

  if (availability === 'loading') return <LoadingCard />;
  if (availability === 'unavailable' || unavailable) return <UnavailableNotice />;

  const INVALID_EMAIL = t('errors.invalidEmail');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const value = email.trim();
    if (!value) { setEmailError(INVALID_EMAIL); emailRef.current?.focus(); return; }
    if (!EMAIL_PATTERN.test(value)) { setEmailError(INVALID_EMAIL); emailRef.current?.focus(); return; }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestPasswordReset(value);
      if (result.success) {
        markCodeSent(value);
        router.push(`/forgot-password/verify?email=${encodeURIComponent(value)}`);
        return;
      }
      if (result.errorCode === 'UNAVAILABLE') { setUnavailable(true); return; }
      if (result.errorCode === 'INVALID_EMAIL') { setEmailError(INVALID_EMAIL); emailRef.current?.focus(); return; }
      // RATE_LIMITED dan sisanya: pesan form tepat di atas tombol utama.
      setError(resetErrorMessage(t, result.errorCode) ?? t('errors.requestFailed'));
    } catch (err) {
      setError(isTransportError(err) ? t('errors.transport') : t('errors.requestFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <ResetCard title={t('request.title')}>
      <p className={"spine-body-sm " + styles.lead}>
        {t('request.lead', { productName: brand.productName, length: RESET_CODE_LENGTH })}
      </p>
      <form className={styles.stack} onSubmit={handleSubmit} noValidate>
        {error && <FormAlert tone="danger">{error}</FormAlert>}
        <TextField
          inputRef={emailRef}
          label={t('request.emailLabel')}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={t('request.emailPlaceholder')}
          value={email}
          error={emailError}
          onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
        />
        <ButtonPrimary type="submit" busy={submitting} busyLabel={t('sending')} style={{ width: '100%' }}>
          {t('request.submit')}
        </ButtonPrimary>
      </form>
      <BackToLogin />
    </ResetCard>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <RequestResetForm />
    </Suspense>
  );
}
