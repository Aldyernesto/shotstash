// Shotstash — Share Link Service
// Layer 3: Business Logic

import { customAlphabet } from 'nanoid';
import prisma from '@/lib/prisma';
import { createNotification } from './notification.service';

type ShareMode = 'PUBLIC' | 'PRIVATE';

// nanoid khusus untuk URL-friendly slugs
const generateSlug = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  12
);

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';

// ============================================
// Create Share Link
// ============================================

export async function createShareLink(data: {
  fileId?: string;
  folderId?: string;
  projectId?: string;
  mode: ShareMode;
  expiresInHours?: number;
  createdById: string;
}) {
  const slug = generateSlug();

  const expiresAt = data.expiresInHours
    ? new Date(Date.now() + data.expiresInHours * 60 * 60 * 1000)
    : null;

  const shareLink = await prisma.shareLink.create({
    data: {
      slug,
      mode: data.mode,
      fileId: data.fileId || null,
      folderId: data.folderId || null,
      projectId2: data.projectId || null,
      createdById: data.createdById,
      expiresAt,
    },
    include: { file: true, folder: true, projectRef: { include: { folders: { where: { parentId: null, trashedAt: null } } } } },
  });

  const url = `${BASE_URL}/s/${slug}`;

  // Notify
  const users = await prisma.user.findMany({ select: { id: true } });
  const name = data.fileId ? (shareLink.file?.originalName || 'a file') : 'a folder';
  for (const u of users) {
    createNotification({
      userId: u.id, type: 'file_shared',
      title: 'File Shared', body: `New share link created for ${name}`,
      data: { slug, fileId: data.fileId || '' },
    }).catch(() => {});
  }

  return { ...shareLink, url };
}

// ============================================
// Access Share Link
// ============================================

export async function accessShareLink(slug: string, userId?: string) {
  const shareLink = await prisma.shareLink.findUnique({
    where: { slug },
    include: {
      file: {
        include: { project: true, uploadedBy: true },
      },
    },
  });

  if (!shareLink) {
    throw new Error('Link tidak ditemukan');
  }

  // Cek expiry
  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    throw new Error('Link sudah kedaluwarsa');
  }

  // Cek akses private
  if (shareLink.mode === 'PRIVATE' && !userId) {
    throw new Error('Anda harus login untuk mengakses link ini');
  }

  // Increment access counter
  await prisma.shareLink.update({
    where: { slug },
    data: { accessCount: { increment: 1 } },
  });

  return shareLink;
}

// ============================================
// Revoke Share Link
// ============================================

// Story 4.4: aturan cabut DISELARASKAN dengan aturan lihat halaman Shared —
// SUPER_ADMIN/ADMIN boleh mencabut link mana pun, role lain hanya miliknya.
// Permintaan yang tidak berhak dijawab satu kalimat yang sama tanpa
// membedakan "tidak ada" dari "bukan milikmu". Barisnya benar-benar
// DIHAPUS (bukan disembunyikan): /s/[slug] jatuh ke notFound() dan
// /api/download?shareSlug= tidak lagi lolos cabang share.
export async function revokeShareLink(id: string, userId: string) {
  const shareLink = await prisma.shareLink.findUnique({
    where: { id },
  });

  const user = shareLink
    ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    : null;
  const adminLike = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  if (!shareLink || (!adminLike && shareLink.createdById !== userId)) {
    throw new Error('Link tidak ditemukan atau bukan milikmu.');
  }

  await prisma.shareLink.delete({ where: { id } });
  return true;
}
