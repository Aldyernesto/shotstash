'use client';

// Langkah 2: masukkan kode dari email → token reset (disimpan di sessionStorage)
// → password baru (Story 1.29). Jam kedaluwarsa absolut ("Code valid until
// 17:00 GMT+7") dihitung di perangkat dari saat kode terakhir dikirim, lalu
// ditampilkan di zona waktu penonton dengan label zona (Story 3.2).

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TextLink } from '@/components/form/buttons';
import CodeInput, { type CodeInputHandle } from '@/components/auth/CodeInput';
import { FormAlert } from '@/components/form/FormAlert';
import { ButtonPrimary } from '@/components/form/buttons';
import { useFormat } from '@/i18n/useFormat';
import styles from '../forgot-password.module.css';
import {
  BackToLogin,
  InfoMessage,
  LoadingCard,
  RESET_CODE_LENGTH,
  ResetCard,
  UnavailableNotice,
  CODE_TTL_MS,
  codeSentAt,
  isTransportError,
  markCodeSent,
  requestPasswordReset,
  resendSecondsLeft,
  resetErrorMessage,
  resetGql,
  saveResetSession,
  usePasswordResetAvailability,
  type PasswordResetResult,
} from '../shared';

const VERIFY_CODE = `mutation VerifyPasswordResetCode($email: String!, $code: String!) {
  verifyPasswordResetCode(email: $email, code: $code) { success message resetToken errorCode }
}`;

const emptyCode = () => Array.from({ length: RESET_CODE_LENGTH }, () => '');

// Langkah 2: masukkan kode dari email → token reset (disimpan di sessionStorage) → password baru.
function VerifyCodeForm() {
  const t = useTranslations('forgotPassword');
  const f = useFormat();
  // Gagal transport (bukan kode salah): kalimat bisa ditindaklanjuti, bukan teks mentah.
  const TRANSPORT_ERROR = t('errors.transport');
  const router = useRouter();
  const email = (useSearchParams().get('email') ?? '').trim();
  const availability = usePasswordResetAvailability();
  const [code, setCode] = useState<string[]>(emptyCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // "Kode berlaku sampai HH:MM WIB" — null saat hidrasi (fallback teks durasi).
  const [expiryMs, setExpiryMs] = useState<number | null>(null);
  const submittingRef = useRef(false);
  const codeRef = useRef<CodeInputHandle>(null);
  // Fokus pasca-submit dijadwalkan, bukan dipanggil langsung (review G1):
  // kirim otomatis mem-blur kotak terakhir dan kotak-kotak masih disabled
  // selama memeriksa/mengirim ulang — focus() ke input disabled adalah
  // no-op. 'last' = kotak terisi terakhir (gagal transport), angka = indeks
  // kotak (locked → 0, kirim ulang → 0).
  const pendingFocusRef = useRef<'last' | number | null>(null);

  // Countdown kirim ulang (60 detik sejak kode terakhir diminta dari browser ini).
  useEffect(() => {
    if (!email) return;
    const tick = () => setCooldown(resendSecondsLeft(email));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [email]);

  // Jam kedaluwarsa dari catatan pengiriman terakhir; tanpa catatan (tautan
  // dibuka langsung) pakai "sekarang" — tetap 15 menit ke depan dari lihat.
  useEffect(() => {
    setExpiryMs((codeSentAt(email) ?? Date.now()) + CODE_TTL_MS);
  }, [email, info]);

  useEffect(() => {
    if (!email) router.replace('/forgot-password');
  }, [email, router]);

  useEffect(() => {
    if (submitting || resending) return;
    const target = pendingFocusRef.current;
    if (target === null) return;
    pendingFocusRef.current = null;
    if (target === 'last') codeRef.current?.focusLastFilled();
    else codeRef.current?.focusAt(target);
  }, [submitting, resending]);

  if (!email || availability === 'loading') return <LoadingCard />;
  if (availability === 'unavailable' || unavailable) return <UnavailableNotice />;

  // Pengguna mengetik lagi setelah kode ditolak → hapus tanda danger.
  const handleCodeChange = (next: string[]) => {
    setCode(next);
    setInvalid(false);
  };

  const submitCode = async (fullCode: string) => {
    if (submittingRef.current) return;
    if (fullCode.length !== RESET_CODE_LENGTH) {
      setError(t('verify.codeIncomplete', { length: RESET_CODE_LENGTH }));
      // Kotak belum disabled (submit belum mulai) — fokus langsung aman;
      // kontrak alur: fokus ke kontrol invalid pertama (review hunter G3).
      codeRef.current?.focusLastFilled();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    setInvalid(false);
    setInfo(null);
    try {
      const data = await resetGql<{ verifyPasswordResetCode: PasswordResetResult }>(VERIFY_CODE, { email, code: fullCode });
      const result = data.verifyPasswordResetCode;
      if (result.success && result.resetToken) {
        // Token hanya hidup di sessionStorage — bila browser memblokirnya,
        // langkah 3 tak akan pernah menemukannya: laporkan sekarang dengan
        // kalimat yang bisa ditindaklanjuti, jangan biarkan pengguna memutar
        // di lingkaran tanpa tahu penyebabnya (review hunter G3).
        if (!saveResetSession(result.resetToken, email)) {
          setError(t('verify.storageBlocked'));
          return;
        }
        router.push('/forgot-password/new');
        return;
      }
      if (result.errorCode === 'UNAVAILABLE') { setUnavailable(true); return; }
      setError(resetErrorMessage(t, result.errorCode) ?? t('errors.invalidCode'));
      if (result.errorCode === 'CODE_LOCKED') {
        setCode(emptyCode());
        // Kotak dikosongkan → fokus kembali ke kotak pertama (setelah disabled lepas).
        pendingFocusRef.current = 0;
      } else {
        // Kode salah/kedaluwarsa: kotak danger, isi dipertahankan, fokus kembali
        // (efek `invalid` di komponen memfokuskan kotak terisi terakhir).
        setInvalid(true);
      }
    } catch (err) {
      // Gagal transport: isi dipertahankan, pesan form-alert, fokus ke kotak
      // terisi terakhir, tombol aktif lagi, TANPA auto-retry. Error GraphQL
      // (server MENJAWAB) memakai pesan servernya — bukan klaim "tidak terhubung".
      if (isTransportError(err)) {
        setError(TRANSPORT_ERROR);
        pendingFocusRef.current = 'last';
      } else {
        setError(t('errors.requestFailed'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    // submitting ikut dijaga: kirim ulang boleh jalan bersamaan dengan
    // verifikasi yang sedang in-flight (review hunter G3).
    if (submitting || cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      const result = await requestPasswordReset(email);
      if (result.success) {
        markCodeSent(email);
        setCooldown(resendSecondsLeft(email));
        setCode(emptyCode());
        setInvalid(false);
        // Kotak dikosongkan → fokus kembali ke kotak pertama, paritas jalur
        // CODE_LOCKED — jangan tinggalkan fokus di tombol kirim ulang (hunter G3).
        pendingFocusRef.current = 0;
        setExpiryMs((codeSentAt(email) ?? Date.now()) + CODE_TTL_MS);
        // Server bisa diam-diam melewati pengiriman (cooldown/kuota) → jangan klaim kode lama mati.
        setInfo(t('verify.resent'));
      } else if (result.errorCode === 'UNAVAILABLE') {
        setUnavailable(true);
      } else {
        setError(resetErrorMessage(t, result.errorCode) ?? t('verify.resendFailed'));
      }
    } catch (err) {
      setError(isTransportError(err) ? TRANSPORT_ERROR : t('verify.resendFailed'));
    } finally {
      setResending(false);
    }
  };

  const mm = Math.floor(cooldown / 60);
  const ss = String(cooldown % 60).padStart(2, '0');

  return (
    <ResetCard title={t('verify.title')}>
      <p className={"spine-body-sm " + styles.lead}>
        {t.rich('verify.lead', { email, length: RESET_CODE_LENGTH, strong: (c) => <strong>{c}</strong> })}{' '}
        {expiryMs !== null
          ? t('verify.validUntil', { time: f.time(new Date(expiryMs)) })
          : t('verify.validFor', { minutes: CODE_TTL_MS / 60000 })}{' '}
        {t('verify.spamHint')}
      </p>
      <form
        className={styles.stack}
        onSubmit={(e) => { e.preventDefault(); void submitCode(code.join('')); }}
      >
        {error && <FormAlert tone="danger">{error}</FormAlert>}
        <InfoMessage>{info}</InfoMessage>
        <CodeInput
          ref={codeRef}
          value={code}
          onChange={handleCodeChange}
          onComplete={(c) => void submitCode(c)}
          disabled={submitting || resending}
          invalid={invalid}
        />
        <ButtonPrimary
          type="submit"
          busy={submitting}
          busyLabel={t('verify.checking')}
          style={{ width: '100%' }}
        >
          {t('verify.submit')}
        </ButtonPrimary>
      </form>
      <div className={"spine-footnote " + styles.resendRow}>
        <span>{t('verify.noCode')}</span>
        <button
          type="button"
          className={`spine-hit-area spine-focus-ring ${styles.linkButton}`}
          onClick={handleResend}
          disabled={submitting || cooldown > 0 || resending}
          aria-busy={resending || undefined}
        >
          {resending ? t('sending') : cooldown > 0 ? t('verify.resendIn', { time: `${mm}:${ss}` }) : t('verify.resend')}
        </button>
      </div>
      <p className={"spine-footnote " + styles.footerLink}>
        {/* Story 1.14: tautan teks spine. */}
        <TextLink href={`/forgot-password?email=${encodeURIComponent(email)}`}>{t('verify.changeEmail')}</TextLink>
      </p>
      <BackToLogin />
    </ResetCard>
  );
}

export default function VerifyCodePage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <VerifyCodeForm />
    </Suspense>
  );
}
