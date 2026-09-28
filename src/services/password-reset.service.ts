// Shotstash — Reset password mandiri via email (kode OTP)
// Spec: docs/history/spec-self-service-password-reset.md
//
// Alur: requestReset(email) → kode 6 karakter via email → verifyCode(email, code) → resetToken
//       → completeReset(resetToken, newPassword, confirmPassword) → password baru, semua sesi dicabut.
//
// Keamanan:
// - Respons requestReset SERAGAM untuk email terdaftar/tidak/nonaktif/kena limit. Semua kerja DB +
//   pengiriman email jalan di belakang (tidak ditunggu), jadi waktu responsnya juga sama.
// - Kode & token hanya disimpan sebagai hash; dibandingkan dengan timingSafeEqual.
// - JANGAN log kode, token, atau password.

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';
import { hashPassword, MIN_PASSWORD_LENGTH } from './auth.service';
import { PASSWORD_TOO_LONG_MESSAGE, passwordProblem } from '@/lib/passwordRule';
import { isEmailConfigured, maskEmail, sendEmail } from './email.service';
import { renderPasswordResetEmail } from '@/emails/PasswordResetEmail';
import { passwordResetLimit } from '@/lib/rateLimit';

// ============================================
// Aturan (lihat matriks di spec)
// ============================================

export const RESET_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RESET_CODE_LENGTH = 6;
export const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_REQUESTS_PER_EMAIL = 3;
export const EMAIL_WINDOW_MS = 15 * 60 * 1000;
// Batas harian per email (jendela 24 jam bergulir) — cegah spam ke inbox user & reputasi pengirim.
export const MAX_REQUESTS_PER_EMAIL_PER_DAY = 10;
export const DAY_WINDOW_MS = 24 * 60 * 60 * 1000;
// Nilai expiresAt untuk kode yang dibatalkan/terpakai/terkunci: selalu di masa lalu untuk `now` mana pun.
const CANCELLED_AT = new Date(0);
export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * English developer messages. Never shown to users: the client renders its
 * own copy from `errorCode` (and `attemptsLeft` for a wrong code).
 */
export const PASSWORD_RESET_MESSAGES = {
  requested: 'If the email is registered, a code was sent.',
  verified: 'Code accepted. Set a new password.',
  completed: 'Password changed. Sign in with the new password.',
  unavailable: 'Password reset is not available',
  rateLimited: 'Too many attempts, try again later',
  invalidEmail: 'Invalid email address',
  invalidCodeFormat: `The code has ${RESET_CODE_LENGTH} letters or digits`,
  invalidCode: 'Wrong or expired code',
  tokenInvalid: 'Reset session ended, start again',
  passwordTooShort: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  passwordTooLong: PASSWORD_TOO_LONG_MESSAGE,
  passwordMismatch: 'Password confirmation does not match',
} as const;

export type PasswordResetErrorCode =
  | 'UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INVALID_EMAIL'
  | 'INVALID_CODE'
  | 'CODE_LOCKED'
  | 'TOKEN_INVALID'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_MISMATCH';

/**
 * A refused reset step. `code` is what the client renders; `message` is an
 * English developer string. `attemptsLeft` is set for a wrong code.
 */
export class PasswordResetError extends Error {
  readonly code: PasswordResetErrorCode;
  readonly attemptsLeft: number | null;
  constructor(code: PasswordResetErrorCode, message: string, attemptsLeft: number | null = null) {
    super(message);
    this.name = 'PasswordResetError';
    this.code = code;
    this.attemptsLeft = attemptsLeft;
  }
}

export function isPasswordResetAvailable(): boolean {
  return isEmailConfigured();
}

function assertAvailable() {
  if (!isPasswordResetAvailable()) {
    throw new PasswordResetError('UNAVAILABLE', PASSWORD_RESET_MESSAGES.unavailable);
  }
}

// ============================================
// Hash & perbandingan
// ============================================

// Pepper server untuk hash kode (kode hanya ~30 bit, jadi jangan simpan SHA polos).
function codePepper() {
  return process.env.SESSION_SECRET || 'shotstash:password-reset';
}

function hashCode(userId: string, code: string): string {
  return createHmac('sha256', codePepper()).update(`${userId}:${code}`).digest('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function generateResetCode(): string {
  let out = '';
  for (let i = 0; i < RESET_CODE_LENGTH; i++) {
    out += RESET_CODE_ALPHABET[randomInt(RESET_CODE_ALPHABET.length)];
  }
  return out;
}

/** Input tidak peka huruf besar/kecil; spasi/tanda hubung diabaikan. null kalau formatnya pasti salah. */
export function normalizeResetCode(input: string): string | null {
  const code = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== RESET_CODE_LENGTH) return null;
  for (const ch of code) if (!RESET_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

// ============================================
// Helpers
// ============================================

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmailInput(email: string): string {
  const value = String(email ?? '').trim();
  if (!value || value.length > 254 || !EMAIL_PATTERN.test(value)) {
    throw new PasswordResetError('INVALID_EMAIL', PASSWORD_RESET_MESSAGES.invalidEmail);
  }
  return value;
}

/** Cocokkan persis dulu, lalu tanpa beda huruf besar/kecil (email lama tersimpan apa adanya). */
async function findUserByEmail(email: string) {
  const exact = await prisma.user.findUnique({ where: { email } });
  if (exact) return exact;
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
  });
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005').replace(/\/+$/, '');
}

// Request throttle: the central sliding-window limiter (Story 2.7), 5 per hour
// per IP and per email. The per-email DB limits below (cooldown, 3 per
// 15 min, 10 per day) stay: they silently skip sending.

// ---- Antrian kerja di belakang, diserialkan per email (cegah balapan cooldown/limit) ----
const pendingWork = new Map<string, Promise<void>>();

function enqueueForEmail(email: string, work: () => Promise<void>) {
  const key = email.toLowerCase();
  const previous = pendingWork.get(key) ?? Promise.resolve();
  const next = previous.then(work).catch((error) => {
    console.error('[password-reset] request failed:', (error as Error)?.message);
  });
  pendingWork.set(key, next);
  void next.finally(() => {
    if (pendingWork.get(key) === next) pendingWork.delete(key);
  });
}

/** Hanya untuk test: tunggu semua permintaan reset yang sedang diproses di belakang. */
export async function waitForPendingResetWork() {
  while (pendingWork.size > 0) {
    await Promise.all([...pendingWork.values()]);
  }
}

// ============================================
// 1) Minta kode
// ============================================

/**
 * Selalu selesai dengan cara yang sama (tidak membocorkan apakah email terdaftar), kecuali:
 * fitur belum aktif, format email jelas salah, atau limit per IP — ketiganya tidak bergantung akun.
 * Email hanya dikirim bila user ada, aktif, bukan REJECTED, dan belum kena cooldown/limit per email.
 */
export async function requestReset(email: string, meta: { ip?: string } = {}): Promise<void> {
  assertAvailable();
  const normalized = normalizeEmailInput(email);
  // Same answer whether or not the email is registered.
  if ((await passwordResetLimit(meta.ip, normalized)) !== null) {
    throw new PasswordResetError('RATE_LIMITED', PASSWORD_RESET_MESSAGES.rateLimited);
  }
  // Sengaja tidak ditunggu: waktu respons sama untuk semua kasus.
  enqueueForEmail(normalized, () => processResetRequest(normalized, meta.ip));
}

async function processResetRequest(email: string, ip?: string) {
  const now = new Date();
  // Bersih-bersih baris terbengkalai (berisi requestIp). Hanya yang > 24 jam — di luar jendela batas harian.
  await prisma.passwordResetRequest.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY_WINDOW_MS) } } });

  const user = await findUserByEmail(email);
  if (!user || !user.active || user.accountStatus === 'REJECTED') return;

  const recentDay = await prisma.passwordResetRequest.findMany({
    where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - DAY_WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const recent = recentDay.filter((r) => r.createdAt.getTime() > now.getTime() - EMAIL_WINDOW_MS);
  if (recentDay.length >= MAX_REQUESTS_PER_EMAIL_PER_DAY) {
    console.warn(`[password-reset] skipped: limit ${MAX_REQUESTS_PER_EMAIL_PER_DAY} per 24 h (to=${maskEmail(user.email)})`);
    return;
  }
  if (recent.length >= MAX_REQUESTS_PER_EMAIL) {
    console.warn(`[password-reset] skipped: limit ${MAX_REQUESTS_PER_EMAIL} per 15 min (to=${maskEmail(user.email)})`);
    return;
  }
  if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS) {
    console.warn(`[password-reset] skipped: resend cooldown (to=${maskEmail(user.email)})`);
    return;
  }

  const code = generateResetCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

  // Render dulu: kalau gagal, belum ada yang berubah (kode lama tetap berlaku, kuota tidak terpakai).
  const rendered = await renderPasswordResetEmail({
    name: user.name,
    email: user.email,
    code,
    expiresAt,
    appUrl: appUrl(),
    googleOnly: !user.passwordHash,
    // Story 3.5: the recipient's language, else the instance default.
    locale: user.locale,
    timeZone: process.env.DEFAULT_TIMEZONE,
    validMinutes: Math.round(CODE_TTL_MS / 60_000),
  });
  const created = await prisma.passwordResetRequest.create({
    data: { userId: user.id, codeHash: hashCode(user.id, code), expiresAt, requestIp: ip ?? null },
    select: { id: true },
  });

  let result: Awaited<ReturnType<typeof sendEmail>>;
  try {
    result = await sendEmail({ to: user.email, subject: rendered.subject, html: rendered.html, text: rendered.text });
  } catch {
    result = { ok: false, error: 'exception' };
  }
  if (!result.ok) {
    // Email tidak terkirim → buang baris baru: kode lama tetap berlaku, cooldown/kuota tidak terpakai.
    await prisma.passwordResetRequest.delete({ where: { id: created.id } }).catch(() => {});
    return;
  }

  // Terkirim → baru batalkan kode (dan token reset) sebelumnya.
  await prisma.passwordResetRequest.updateMany({
    where: { userId: user.id, id: { not: created.id }, OR: [{ expiresAt: { gt: CANCELLED_AT } }, { resetTokenHash: { not: null } }] },
    data: { expiresAt: CANCELLED_AT, resetTokenHash: null, resetTokenExpiresAt: null },
  });
  console.info(`[password-reset] code sent (to=${maskEmail(user.email)})`);
}

// ============================================
// 2) Verifikasi kode → token reset
// ============================================

function isRecordNotFound(error: unknown) {
  return (error as { code?: string } | null)?.code === 'P2025';
}

export async function verifyCode(email: string, codeInput: string): Promise<{ resetToken: string }> {
  assertAvailable();
  const normalizedEmail = normalizeEmailInput(email);
  const code = normalizeResetCode(codeInput);
  if (!code) throw new PasswordResetError('INVALID_CODE', PASSWORD_RESET_MESSAGES.invalidCodeFormat);

  const invalid = () => new PasswordResetError('INVALID_CODE', `${PASSWORD_RESET_MESSAGES.invalidCode}.`);

  const user = await findUserByEmail(normalizedEmail);
  if (!user || !user.active || user.accountStatus === 'REJECTED') throw invalid();

  const now = new Date();
  const active = await prisma.passwordResetRequest.findFirst({
    where: { userId: user.id, expiresAt: { gt: now }, attempts: { lt: MAX_CODE_ATTEMPTS }, resetTokenHash: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!active) throw invalid();

  // Ambil jatah percobaan secara atomik (aman dari tebakan paralel).
  let attempts: number;
  try {
    const claimed = await prisma.passwordResetRequest.update({
      where: { id: active.id, attempts: { lt: MAX_CODE_ATTEMPTS }, expiresAt: { gt: now }, AND: { resetTokenHash: null } },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    attempts = claimed.attempts;
  } catch (error) {
    if (isRecordNotFound(error)) throw invalid();
    throw error;
  }

  if (safeEqualHex(hashCode(user.id, code), active.codeHash)) {
    const resetToken = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
    const issued = await prisma.passwordResetRequest.updateMany({
      where: { id: active.id, resetTokenHash: null, expiresAt: { gt: now } },
      data: {
        resetTokenHash: hashToken(resetToken),
        resetTokenExpiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        expiresAt: CANCELLED_AT, // kode sudah terpakai
      },
    });
    if (issued.count !== 1) throw invalid();
    return { resetToken };
  }

  const remaining = MAX_CODE_ATTEMPTS - attempts;
  if (remaining <= 0) {
    await prisma.passwordResetRequest.updateMany({ where: { id: active.id }, data: { expiresAt: CANCELLED_AT } });
    throw new PasswordResetError(
      'CODE_LOCKED',
      `${PASSWORD_RESET_MESSAGES.invalidCode}; cancelled after ${MAX_CODE_ATTEMPTS} wrong tries`,
    );
  }
  throw new PasswordResetError(
    'INVALID_CODE',
    `${PASSWORD_RESET_MESSAGES.invalidCode}; ${remaining} attempts left`,
    remaining,
  );
}

// ============================================
// 3) Password baru
// ============================================

export function validateNewPassword(newPassword: string, confirmPassword: string) {
  const problem = passwordProblem(newPassword);
  if (problem === 'PASSWORD_TOO_SHORT') {
    throw new PasswordResetError('PASSWORD_TOO_SHORT', PASSWORD_RESET_MESSAGES.passwordTooShort);
  }
  if (problem === 'PASSWORD_TOO_LONG') {
    throw new PasswordResetError('PASSWORD_TOO_LONG', PASSWORD_RESET_MESSAGES.passwordTooLong);
  }
  if (newPassword !== confirmPassword) {
    throw new PasswordResetError('PASSWORD_MISMATCH', PASSWORD_RESET_MESSAGES.passwordMismatch);
  }
}

/**
 * Token sekali pakai. Sukses → passwordHash diperbarui, SEMUA PasswordResetRequest & Session user
 * dihapus (perangkat lain ter-logout). Tidak ada auto-login.
 */
export async function completeReset(resetToken: string, newPassword: string, confirmPassword: string) {
  assertAvailable();
  const tokenInvalid = () => new PasswordResetError('TOKEN_INVALID', PASSWORD_RESET_MESSAGES.tokenInvalid);

  const token = String(resetToken ?? '');
  if (!token || token.length > 128) throw tokenInvalid();
  const tokenHash = hashToken(token);

  const now = new Date();
  const request = await prisma.passwordResetRequest.findUnique({
    where: { resetTokenHash: tokenHash },
    include: { user: { select: { id: true, email: true, active: true, accountStatus: true } } },
  });
  if (
    !request?.resetTokenHash ||
    !safeEqualHex(request.resetTokenHash, tokenHash) ||
    !request.resetTokenExpiresAt ||
    request.resetTokenExpiresAt <= now ||
    !request.user.active ||
    request.user.accountStatus === 'REJECTED'
  ) {
    throw tokenInvalid();
  }

  validateNewPassword(newPassword, confirmPassword);
  const passwordHash = await hashPassword(newPassword);
  const userId = request.user.id;

  const sessionsRevoked = await prisma.$transaction(async (tx) => {
    // Klaim token secara atomik — pemakaian kedua (paralel) gagal di sini.
    const consumed = await tx.passwordResetRequest.deleteMany({
      where: { id: request.id, resetTokenHash: tokenHash, resetTokenExpiresAt: { gt: now } },
    });
    if (consumed.count !== 1) throw tokenInvalid();
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.passwordResetRequest.deleteMany({ where: { userId } });
    const sessions = await tx.session.deleteMany({ where: { userId } });
    return sessions.count;
  });

  console.info(`[password-reset] password changed (to=${maskEmail(request.user.email)}, sessions revoked=${sessionsRevoked})`);
  return { userId, email: request.user.email, sessionsRevoked };
}
