'use client';

// Bagian bersama alur reset password (/forgot-password/*). Semua request lewat fetch biasa
// (bukan Apollo) dan TANPA header Authorization — mutasinya publik.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { TextLink } from '@/components/form/buttons';
import AuthCard from '@/components/auth/AuthCard';
import { brand } from '@/lib/brand';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '@/lib/passwordRule';
import styles from './forgot-password.module.css';

// Kontrak kode 6 karakter: SATU sumber klien di komponen CodeInput (Story
// 1.26) — duplikasi server di password-reset.service.ts disengaja (batas
// server/klien), duplikasi antar-modul klien tidak.
export { CODE_LENGTH as RESET_CODE_LENGTH, CODE_ALPHABET as RESET_CODE_ALPHABET } from '@/components/auth/CodeInput';
export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordProblem } from '@/lib/passwordRule';
export const RESEND_COOLDOWN_SECONDS = 60;
// Paritas konstanta server (password-reset.service.ts) untuk jam kedaluwarsa
// yang dihitung di perangkat (AC 1.28/1.30 — harus cocok dengan isi email).
export const CODE_TTL_MS = 15 * 60 * 1000;
export const RESET_SESSION_TTL_MS = 10 * 60 * 1000;
// Story 1.31: email dibawa ke halaman masuk lewat sessionStorage — tanpa
// query param supaya halaman masuk tidak perlu dibungkus Suspense baru.
export const LOGIN_PREFILL_KEY = 'shotstash_login_prefill';

// sessionStorage: token reset (dihapus setelah dipakai), waktu kirim terakhir
// (countdown kirim ulang + dasar "Kode berlaku sampai…"), email prefill login.
const TOKEN_KEY = 'shotstash_pwreset_token';
const SENT_KEY = 'shotstash_pwreset_sent';

export type PasswordResetResult = {
  success: boolean;
  message: string | null;
  resetToken: string | null;
  errorCode: string | null;
};

export type ResetT = ReturnType<typeof useTranslations<'forgotPassword'>>;

// Kode error server (PasswordResetErrorCode + INTERNAL) -> kunci pesan klien.
// Copy selalu dari messages, bukan teks mentah server.
const RESET_ERROR_KEYS = {
  UNAVAILABLE: 'unavailable',
  RATE_LIMITED: 'rateLimited',
  INVALID_EMAIL: 'invalidEmail',
  INVALID_CODE: 'invalidCode',
  CODE_LOCKED: 'codeLocked',
  TOKEN_INVALID: 'tokenInvalid',
  PASSWORD_TOO_SHORT: 'passwordTooShort',
  PASSWORD_TOO_LONG: 'passwordTooLong',
  PASSWORD_MISMATCH: 'passwordMismatch',
  INTERNAL: 'internal',
} as const;

/** Pesan untuk kode error server yang dikenal; null untuk kode lain/kosong. */
export function resetErrorMessage(t: ResetT, code: string | null | undefined): string | null {
  if (!code || !Object.prototype.hasOwnProperty.call(RESET_ERROR_KEYS, code)) return null;
  const key = RESET_ERROR_KEYS[code as keyof typeof RESET_ERROR_KEYS];
  return t(`errors.${key}`, { min: MIN_PASSWORD_LENGTH, max: MAX_PASSWORD_BYTES });
}

/** True bila kegagalan berasal dari jaringan/balasan bukan JSON — bukan error GraphQL (server menjawab). */
export function isTransportError(err: unknown): err is Error & { transport: true } {
  return err instanceof Error && (err as Error & { transport?: boolean }).transport === true;
}

export async function resetGql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    // fetch() menolak (offline, DNS, CORS mati) = gagal transport (review G1).
    throw withTransport(new Error('Server did not respond.'));
  }
  const json = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!json) throw withTransport(new Error('Server did not respond.'));
  if (json.errors?.length || !json.data) throw new Error(json.errors?.[0]?.message || 'Request failed.');
  return json.data;
}

function withTransport(err: Error): Error & { transport: true } {
  return Object.assign(err, { transport: true as const });
}

const REQUEST_RESET = `mutation RequestPasswordReset($email: String!) {
  requestPasswordReset(email: $email) { success message resetToken errorCode }
}`;

export async function requestPasswordReset(email: string): Promise<PasswordResetResult> {
  const data = await resetGql<{ requestPasswordReset: PasswordResetResult }>(REQUEST_RESET, { email });
  return data.requestPasswordReset;
}

export type Availability = 'loading' | 'available' | 'unavailable';

/** Fitur aktif hanya bila server punya konfigurasi provider email. */
export function usePasswordResetAvailability(): Availability {
  const [state, setState] = useState<Availability>('loading');
  useEffect(() => {
    let alive = true;
    resetGql<{ passwordResetAvailable: boolean }>('query PasswordResetAvailable { passwordResetAvailable }')
      .then((d) => { if (alive) setState(d.passwordResetAvailable ? 'available' : 'unavailable'); })
      .catch(() => { if (alive) setState('unavailable'); });
    return () => { alive = false; };
  }, []);
  return state;
}

// ---- sessionStorage (dibungkus try/catch: bisa diblokir di mode privat) ----

/** Simpan sesi reset; false bila penyimpanan diblokir browser (mode privat/
 * ekstensi). Pemanggil WAJIB menampilkan kegagalan ini sebagai error yang
 * bisa ditindaklanjuti — diam-diam berarti pengguna memutar di lingkaran
 * tanpa tahu penyebabnya (review hunter G3). */
export function saveResetSession(token: string, email: string): boolean {
  // `at` = saat verifikasi berhasil — dasar "Sesi reset berlaku sampai…" (AC 1.30).
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, email, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

function parseResetSession(raw: string | null): { token: string; email: string; at?: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; email?: unknown; at?: unknown };
    if (typeof parsed.token !== 'string' || !parsed.token) return null;
    return {
      token: parsed.token,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      at: typeof parsed.at === 'number' ? parsed.at : undefined,
    };
  } catch {
    return null;
  }
}

function readRawResetSession(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

const noopSubscribe = () => () => {};

/** Token reset dari sessionStorage. undefined = belum diketahui (render server / hidrasi). */
export function useResetSession(): { token: string; email: string; at?: number } | null | undefined {
  const raw = useSyncExternalStore<string | null | undefined>(noopSubscribe, readRawResetSession, () => undefined);
  return useMemo(
    () => (raw === undefined ? undefined : parseResetSession(raw)),
    [raw],
  );
}

export function clearResetSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(SENT_KEY);
  } catch {}
}

export function markCodeSent(email: string) {
  try { sessionStorage.setItem(SENT_KEY, JSON.stringify({ email: email.toLowerCase(), at: Date.now() })); } catch {}
}

/** Detik tersisa sebelum boleh kirim ulang untuk email ini (0 = boleh). */
export function resendSecondsLeft(email: string): number {
  try {
    const raw = sessionStorage.getItem(SENT_KEY);
    if (!raw) return 0;
    const { email: sentTo, at } = JSON.parse(raw) as { email?: string; at?: number };
    if (sentTo !== email.toLowerCase() || typeof at !== 'number') return 0;
    return Math.max(0, Math.ceil((at + RESEND_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

/** Saat kode terakhir dikirim untuk email ini (ms epoch) — null bila tidak ada catatan. */
export function codeSentAt(email: string): number | null {
  try {
    const raw = sessionStorage.getItem(SENT_KEY);
    if (!raw) return null;
    const { email: sentTo, at } = JSON.parse(raw) as { email?: string; at?: number };
    if (sentTo !== email.toLowerCase() || typeof at !== 'number') return null;
    return at;
  } catch {
    return null;
  }
}

// ---- UI ----

/** Kartu reset di atas auth-card bersama (Story 1.28) — tanpa pill & sub;
 * judul h1 agar keempat langkah punya satu h1 konsisten (layar done memakai
 * h1 di slot head-nya sendiri — review hunter G3). */
export function ResetCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <AuthCard title={title} titleAs="h1" pill={null} subtitle={null} form={children} />
  );
}

export function BackToLogin({ onClick }: { onClick?: () => void } = {}) {
  const t = useTranslations('forgotPassword');
  return (
    <p className={"spine-footnote " + styles.footerLink}>
      {/* Story 1.14: tautan teks spine (garis bawah 2px, offset 4px). */}
      <TextLink href="/" onClick={onClick}>{t('backToLogin')}</TextLink>
    </p>
  );
}

export function UnavailableNotice() {
  const t = useTranslations('forgotPassword');
  return (
    <ResetCard title={t('resetTitle')}>
      <p className={"spine-body-sm " + styles.lead}>
        {t('unavailable', { productName: brand.productName })}
      </p>
      <BackToLogin />
    </ResetCard>
  );
}

export function LoadingCard() {
  const t = useTranslations('forgotPassword');
  const tc = useTranslations('common');
  return (
    <ResetCard title={t('resetTitle')}>
      <p className={"spine-body-sm " + styles.lead}>{tc('loading')}</p>
    </ResetCard>
  );
}

/** Pesan netral (kirim ulang dsb.): not danger, not ok: soft accent tint + role="status". */
export function InfoMessage({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p role="status" className={"spine-footnote " + styles.info}>{children}</p>;
}
