// Shotstash — Auth Service
// Layer 3: Business Logic
// Security: Argon2id + HttpOnly Secure Cookie

import * as bcrypt from 'bcryptjs';
import { randomInt, randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { GOOGLE_ONLY_MARKER } from '@/lib/authMessages';
import { isEmailConfigured } from './email.service';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'FIELD_CREW' | 'EDITOR' | 'VIEWER';

// ============================================
// Cookie Configuration
// ============================================

export const SESSION_COOKIE_NAME = 'shotstash_session';

export const COOKIE_OPTIONS = {
  httpOnly: true,        // Anti-XSS: JS tidak bisa akses cookie
  secure: process.env.NODE_ENV === 'production', // HTTPS only di production
  sameSite: 'lax' as const,  // Anti-CSRF
  maxAge: 7 * 24 * 60 * 60,  // 7 hari
  path: '/',
  domain: process.env.COOKIE_DOMAIN || undefined,
};

// ============================================
// Password Hashing (Bcryptjs)
// ============================================

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ============================================
// Session Management
// ============================================

export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + COOKIE_OPTIONS.maxAge * 1000);

  const session = await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt,
      ipAddress: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });

  return session;
}

export async function validateSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!session) return null;

  // Session expired?
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  return session;
}

export async function destroySession(token: string) {
  await prisma.session.delete({ where: { token } }).catch(() => {
    // Session mungkin sudah expired/dihapus
  });
}

// ============================================
// User CRUD
// ============================================

export async function registerUser(data: {
  name: string;
  email: string;
  password: string;
  role?: Role;         // role yang DIMINTA (requestedRole), bukan hak langsung
  signupAnswers?: any;
  approved?: boolean;  // true kalau dibuat admin (langsung ACTIVE)
}) {
  const existingUser = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (existingUser) {
    throw new Error('Email sudah terdaftar');
  }

  const passwordHash = await hashPassword(data.password);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      // Signup publik TIDAK menentukan role sendiri. Role asli diberikan admin saat approve.
      // requestedRole = role yang diminta (dipakai admin sebagai referensi).
      role: 'EDITOR',
      requestedRole: data.role || null,
      accountStatus: data.approved ? 'ACTIVE' : 'PENDING',
      signupAnswers: data.signupAnswers === undefined ? undefined : data.signupAnswers,
    },
  });

  return user;
}

export async function loginUser(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error('Email atau password salah');
  }

  if (!user.passwordHash) {
    // GOOGLE_ONLY_MARKER dipakai halaman login (src/app/page.tsx) untuk menyorot tombol Google.
    // Opsi "Lupa password?" hanya disebut kalau fitur reset via email sudah aktif (env Resend ada).
    const passwordOption = isEmailConfigured()
      ? 'atau buat password sendiri lewat "Lupa password?" di halaman login mam.example.com.'
      : 'atau minta admin Shotstash membuatkan password.';
    throw new Error(
      `Akun ini ${GOOGLE_ONLY_MARKER}, jadi belum punya password. Tekan tombol "Login dengan Google" ` +
      `(bukan aplikasi Google Authenticator), ${passwordOption}`
    );
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    throw new Error('Email atau password salah');
  }

  if (!user.active) {
    throw new Error('Akun telah dinonaktifkan');
  }

  if (user.accountStatus === 'REJECTED') {
    throw new Error('Pendaftaran akun ditolak oleh admin.');
  }

  // Catatan: status PENDING tetap boleh login supaya user bisa lihat layar
  // "menunggu persetujuan" / melengkapi onboarding. Akses fitur dibatasi di layer lain.
  return user;
}

export async function deactivateUser(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { active: false },
  });
}

export async function reactivateUser(userId: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { active: true },
  });
}

export async function updateUserRole(userId: string, role: Role) {
  return prisma.user.update({
    where: { id: userId },
    data: { role },
  });
}

export async function getUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: { sessions: true },
  });
}

// ============================================
// Admin: reset password & hapus akun
// ============================================

/** Error yang pesannya aman ditampilkan apa adanya ke admin (Bahasa Indonesia). */
export class AdminActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminActionError';
  }
}

export const MIN_PASSWORD_LENGTH = 8;
const GENERATED_PASSWORD_LENGTH = 10;
// Tanpa karakter ambigu: 0/O/o, 1/l/I/i.
const GENERATED_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generateReadablePassword(length = GENERATED_PASSWORD_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += GENERATED_PASSWORD_ALPHABET[randomInt(GENERATED_PASSWORD_ALPHABET.length)];
  }
  return out;
}

async function findAdminTarget(targetId: string, db: Prisma.TransactionClient = prisma) {
  const target = await db.user.findUnique({
    where: { id: targetId },
    select: { id: true, email: true, role: true },
  });
  if (!target) throw new AdminActionError('User tidak ditemukan.');
  // Pertahanan berlapis: akun SUPER_ADMIN tidak boleh direset/dihapus lewat panel admin.
  if (target.role === 'SUPER_ADMIN') {
    throw new AdminActionError('Akun SUPER_ADMIN tidak bisa direset atau dihapus dari panel admin.');
  }
  return target;
}

/**
 * Set/reset password user (termasuk akun Google-only). Tanpa `newPassword` → dibuatkan
 * password acak. Semua sesi user dihapus sehingga token lama tidak berlaku lagi.
 * Password hasil generate hanya dikembalikan di sini — tidak disimpan plain & tidak di-log.
 */
export async function adminSetPassword(targetId: string, newPassword?: string | null) {
  const isManual = newPassword !== undefined && newPassword !== null;
  if (isManual && newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AdminActionError(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
  }

  const target = await findAdminTarget(targetId);
  const password = isManual ? newPassword : generateReadablePassword();
  const passwordHash = await hashPassword(password);

  const [, deletedSessions] = await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: target.id } }),
    // Kode/token reset mandiri yang masih hidup tidak boleh menimpa password yang diatur admin.
    prisma.passwordResetRequest.deleteMany({ where: { userId: target.id } }),
  ]);

  return {
    userId: target.id,
    email: target.email,
    generatedPassword: isManual ? null : password,
    sessionsRevoked: deletedSessions.count,
  };
}

/**
 * Hapus akun yang belum punya aktivitas (upload, share link, chat). Akun beraktivitas
 * ditolak — pakai Nonaktifkan supaya jejak kepemilikan file tetap utuh.
 * Session, device record, Notification ikut terhapus lewat onDelete: Cascade.
 */
export async function deleteUserAccount(targetId: string) {
  return prisma.$transaction(async (tx) => {
    const target = await findAdminTarget(targetId, tx);

    const [uploads, shareLinks, chats] = await Promise.all([
      tx.mediaFile.count({ where: { uploadedById: target.id } }),
      tx.shareLink.count({ where: { createdById: target.id } }),
      tx.projectChat.count({ where: { senderId: target.id } }),
    ]);

    if (uploads + shareLinks + chats > 0) {
      const parts: string[] = [];
      if (uploads > 0) parts.push(`${uploads} file upload`);
      if (shareLinks > 0) parts.push(`${shareLinks} share link`);
      if (chats > 0) parts.push(`${chats} pesan chat`);
      throw new AdminActionError(
        `Akun ${target.email} tidak bisa dihapus karena punya aktivitas: ${parts.join(', ')}. ` +
        'Gunakan "Nonaktifkan" untuk memblokir akses tanpa menghapus datanya.'
      );
    }

    // UploadSession.uploadedById FK Restrict → hapus dulu sebelum user.
    await tx.uploadSession.deleteMany({ where: { uploadedById: target.id } });
    await tx.user.delete({ where: { id: target.id } });

    return { userId: target.id, email: target.email };
  });
}
