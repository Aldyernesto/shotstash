'use client';

// Langkah 1: minta kode reset (Story 1.28). Respons server selalu seragam
// (tidak membocorkan email terdaftar); error unik hanya UNAVAILABLE,
// RATE_LIMITED, dan INVALID_EMAIL (invalid → error di bawah kolom email).

import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TextField from '@/components/form/TextField';
import styles from './forgot-password.module.css';
import { ButtonPrimary } from '@/components/form/buttons';
import { FormAlert } from '@/components/form/FormAlert';
import {
  BackToLogin,
  LoadingCard,
  ResetCard,
  UnavailableNotice,
  isTransportError,
  markCodeSent,
  requestPasswordReset,
  usePasswordResetAvailability,
} from './shared';

// Cukup untuk menangkap salah ketik jelas; keputusan final tetap milik server.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVALID_EMAIL = 'Masukkan alamat email yang valid.';

function RequestResetForm() {
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
      if (result.errorCode === 'INVALID_EMAIL') { setEmailError(result.message || INVALID_EMAIL); emailRef.current?.focus(); return; }
      // RATE_LIMITED dan sisanya: pesan form tepat di atas tombol utama.
      setError(result.message || 'Permintaan gagal. Coba lagi.');
    } catch (err) {
      setError(isTransportError(err) ? 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.' : (err as Error)?.message || 'Permintaan gagal. Coba lagi.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <ResetCard title="Lupa password?">
      <p className={"spine-body-sm " + styles.lead}>
        Masukkan email akun Shotstash kamu. Kami akan mengirim kode 6 karakter untuk membuat password baru.
      </p>
      <form className={styles.stack} onSubmit={handleSubmit} noValidate>
        {error && <FormAlert tone="danger">{error}</FormAlert>}
        <TextField
          inputRef={emailRef}
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="nama@email.com"
          value={email}
          error={emailError}
          onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
        />
        <ButtonPrimary type="submit" busy={submitting} busyLabel="Mengirim..." style={{ width: '100%' }}>
          Kirim kode
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
