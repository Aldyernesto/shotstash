'use client';

// Langkah 3: password baru memakai token sekali-pakai dari langkah 2 (Story
// 1.30). Validasi klien hanya mencegah round-trip yang pasti gagal — server
// tetap sumber kebenaran (PASSWORD_TOO_SHORT / PASSWORD_MISMATCH / TOKEN_INVALID).
// Sukses: email disimpan untuk prefill halaman masuk (LOGIN_PREFILL_KEY,
// Story 1.31), sesi reset dihapus dari sessionStorage, lalu pindah ke /done.

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PasswordInput from '@/components/PasswordInput';
import fieldStyles from '@/components/form/TextField.module.css';
import { ButtonPrimary } from '@/components/form/buttons';
import { FormAlert } from '@/components/form/FormAlert';
import { formatTimeWIB } from '@/lib/format';
import styles from '../forgot-password.module.css';
import {
  BackToLogin,
  LoadingCard,
  LOGIN_PREFILL_KEY,
  MIN_PASSWORD_LENGTH,
  RESET_SESSION_TTL_MS,
  ResetCard,
  UnavailableNotice,
  clearResetSession,
  isTransportError,
  resetGql,
  useResetSession,
  type PasswordResetResult,
} from '../shared';

const COMPLETE_RESET = `mutation CompletePasswordReset($resetToken: String!, $newPassword: String!, $confirmPassword: String!) {
  completePasswordReset(resetToken: $resetToken, newPassword: $newPassword, confirmPassword: $confirmPassword) {
    success message resetToken errorCode
  }
}`;

// Gagal transport (bukan penolakan server): kalimat bisa ditindaklanjuti.
const TRANSPORT_ERROR = 'Tidak bisa terhubung ke server. Periksa koneksi lalu coba lagi.';
const TOO_SHORT = `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`;
const MISMATCH = 'Konfirmasi password tidak sama.';

// Markup error identik kontrak text-field (TextField.tsx) — dikomposisi manual
// karena field-nya PasswordInput + label eksplisit (pola halaman masuk).
function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p className={`spine-footnote ${fieldStyles.errorText}`} id={id}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function NewPasswordForm() {
  const router = useRouter();
  const session = useResetSession();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // Token kedaluwarsa/dipakai → kartu khusus, sesi sudah dibuang dari storage.
  const [expired, setExpired] = useState(false);
  // "Sesi reset berlaku sampai HH:MM WIB" — null saat hidrasi (fallback durasi).
  const [expiryMs, setExpiryMs] = useState<number | null>(null);
  const submittingRef = useRef(false);
  // Pengaman navigasi keluar (review hunter G3): begitu sesi dihapus — sukses
  // reset ATAU "Kembali ke halaman masuk" — efek "tanpa sesi → langkah 1"
  // tidak boleh menimpa navigasi yang sedang berjalan. State (bukan hanya
  // ref) supaya RENDER ikut berpindah ke LoadingCard: `setSubmitting(false)`
  // di `finally` memicu re-render dengan sesi sudah null sebelum navigasi
  // commit — tanpa ini kartu "belum tersedia" menyambar di jendela itu.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const startLeave = () => {
    leavingRef.current = true;
    setLeaving(true);
  };
  const newPwRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const pwErrorId = useId();
  const confirmErrorId = useId();

  // Tanpa sesi (tautan dibuka langsung / token sudah terpakai) → langkah 1.
  useEffect(() => {
    if (session === null && !expired && !leavingRef.current) router.replace('/forgot-password');
  }, [session, expired, router]);

  // Jam kedaluwarsa dari saat verifikasi berhasil (sessionStorage `at`) —
  // dihitung di effect, bukan render, agar hasil hidrasi deterministik.
  useEffect(() => {
    if (session?.at) setExpiryMs(session.at + RESET_SESSION_TTL_MS);
  }, [session?.at]);

  // Navigasi keluar sedang berjalan → spinner sampai halaman tujuan siap;
  // cabang-cabang di bawah tidak boleh menyambar di jendela navigasi.
  if (session === undefined || leaving) return <LoadingCard />;

  if (expired) {
    return (
      <ResetCard title="Sesi reset berakhir">
        <p className={"spine-body-sm " + styles.lead}>Sesi reset berakhir, ulangi dari awal.</p>
        <ButtonPrimary onClick={() => router.push('/forgot-password')} style={{ width: '100%', marginTop: 16 }}>
          Minta kode baru
        </ButtonPrimary>
        <BackToLogin />
      </ResetCard>
    );
  }

  if (unavailable) return <UnavailableNotice />;
  // Tanpa sesi → efek di atas membawa ke langkah 1; selama menunggu, spinner —
  // BUKAN kartu "belum tersedia" yang copy-nya menyesatkan di kondisi ini.
  if (session === null) return <LoadingCard />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    // Fokus ke field invalid pertama, seperti kontrak form spine.
    let focusTarget: HTMLInputElement | null = null;
    if (newPassword.length < MIN_PASSWORD_LENGTH) { setPwError(TOO_SHORT); focusTarget = newPwRef.current; }
    if (confirmPassword !== newPassword) { setConfirmError(MISMATCH); focusTarget ??= confirmRef.current; }
    if (focusTarget) { focusTarget.focus(); return; }

    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const data = await resetGql<{ completePasswordReset: PasswordResetResult }>(COMPLETE_RESET, {
        resetToken: session.token,
        newPassword,
        confirmPassword,
      });
      const result = data.completePasswordReset;
      if (result.success) {
        // Story 1.31: prefill halaman masuk dengan email yang direset.
        startLeave();
        try { sessionStorage.setItem(LOGIN_PREFILL_KEY, session.email); } catch {}
        // Keluar dari alur → token reset jangan dibiarkan hidup di sessionStorage.
        clearResetSession();
        router.replace('/forgot-password/done');
        return;
      }
      switch (result.errorCode) {
        case 'UNAVAILABLE': setUnavailable(true); break;
        // TOKEN_INVALID: pesan server "Sesi reset berakhir, ulangi dari awal" → kartu khusus.
        case 'TOKEN_INVALID': setExpired(true); clearResetSession(); break;
        case 'PASSWORD_TOO_SHORT': setPwError(result.message || TOO_SHORT); newPwRef.current?.focus(); break;
        case 'PASSWORD_MISMATCH': setConfirmError(result.message || MISMATCH); confirmRef.current?.focus(); break;
        default: setFormError(result.message || 'Gagal menyimpan password. Coba lagi.');
      }
    } catch (err) {
      setFormError(isTransportError(err) ? TRANSPORT_ERROR : err instanceof Error && err.message ? err.message : 'Gagal menyimpan password. Coba lagi.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <ResetCard title="Buat password baru">
      <p className={"spine-body-sm " + styles.lead}>
        {session.email ? (
          <>
            Password baru untuk <strong>{session.email}</strong>.{' '}
          </>
        ) : null}
        Setelah disimpan, semua perangkat yang sedang login akan keluar.
      </p>
      <p className={`spine-footnote ${styles.sessionNote}`}>
        {expiryMs !== null ? `Sesi reset berlaku sampai ${formatTimeWIB(new Date(expiryMs))}.` : 'Sesi reset berlaku 10 menit.'}
      </p>
      <form className={styles.stack} onSubmit={handleSubmit} noValidate>
        {formError && <FormAlert tone="danger">{formError}</FormAlert>}
        {/* Membantu password manager menyimpan password baru untuk akun yang benar. */}
        <input type="text" name="username" autoComplete="username" value={session.email} readOnly hidden />
        <div className={fieldStyles.field}>
          {/* Pola halaman masuk: hint panjang minimal di ATAS label (bukan placeholder). */}
          <p className={`spine-footnote ${styles.minHint}`}>Minimal {MIN_PASSWORD_LENGTH} karakter.</p>
          <label className={`spine-label ${fieldStyles.label}`} htmlFor="new-password">
            Password baru
          </label>
          <PasswordInput
            id="new-password"
            inputRef={newPwRef}
            value={newPassword}
            onChange={(e) => { setNewPassword(e.target.value); setPwError(null); }}
            className={`spine-focus-ring ${fieldStyles.input}`}
            placeholder="••••••••"
            autoFocus
            autoComplete="new-password"
            aria-invalid={pwError ? true : undefined}
            aria-describedby={pwError ? pwErrorId : undefined}
          />
          {pwError && <FieldError id={pwErrorId}>{pwError}</FieldError>}
        </div>
        <div className={fieldStyles.field}>
          <label className={`spine-label ${fieldStyles.label}`} htmlFor="confirm-password">
            Ulangi password baru
          </label>
          <PasswordInput
            id="confirm-password"
            inputRef={confirmRef}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setConfirmError(null); }}
            className={`spine-focus-ring ${fieldStyles.input}`}
            placeholder="••••••••"
            autoComplete="new-password"
            aria-invalid={confirmError ? true : undefined}
            aria-describedby={confirmError ? confirmErrorId : undefined}
          />
          {confirmError && <FieldError id={confirmErrorId}>{confirmError}</FieldError>}
        </div>
        <ButtonPrimary type="submit" busy={submitting} busyLabel="Menyimpan..." style={{ width: '100%' }}>
          Simpan password
        </ButtonPrimary>
      </form>
      <BackToLogin onClick={() => { startLeave(); clearResetSession(); }} />
    </ResetCard>
  );
}

export default function NewPasswordPage() {
  return <NewPasswordForm />;
}
