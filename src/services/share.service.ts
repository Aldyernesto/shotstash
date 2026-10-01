// Shotstash Share Link Service

import { customAlphabet } from 'nanoid';
import prisma from '@/lib/prisma';
import { config } from '@/lib/config';
import { createNotification } from '@/modules/activity';
import { generateAccessCode, hashAccessCode } from '@/modules/share';
import { codedError } from '@/modules/errors';

type ShareMode = 'PUBLIC' | 'PRIVATE';

// nanoid khusus untuk URL-friendly slugs
const generateSlug = customAlphabet(
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  12
);


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
  const targets = [data.fileId, data.folderId, data.projectId].filter(Boolean);
  if (targets.length !== 1) throw codedError('INVALID_SHARE_TARGET', 'Exactly one target is required: fileId, folderId or projectId');

  const slug = generateSlug();

  const expiresAt = data.expiresInHours
    ? new Date(Date.now() + data.expiresInHours * 60 * 60 * 1000)
    : null;

  // PRIVATE: a one-time access code; only its hash is stored.
  const accessCode = data.mode === 'PRIVATE' ? generateAccessCode() : null;

  const shareLink = await prisma.shareLink.create({
    data: {
      slug,
      mode: data.mode,
      fileId: data.fileId || null,
      folderId: data.folderId || null,
      projectId2: data.projectId || null,
      createdById: data.createdById,
      expiresAt,
      accessCodeHash: accessCode ? hashAccessCode(accessCode) : null,
    },
    include: { file: true, folder: true, projectRef: { include: { folders: { where: { parentId: null, trashedAt: null } } } } },
  });

  const url = `${config().appUrl}/s/${slug}`;

  // Only the creator is notified: other users may not be allowed to see the target.
  const targetKind = data.fileId ? 'file' : data.folderId ? 'section' : 'project';
  const fileName =
    shareLink.file?.originalName ?? shareLink.folder?.name ?? shareLink.projectRef?.title ?? '';
  createNotification({
    userId: data.createdById, type: 'file_shared',
    // English fallback; the bell renders from type + data.
    title: 'Share link created', body: `New share link for ${fileName || `a ${targetKind}`}`,
    data: { slug, fileId: data.fileId || '', fileName, targetKind },
  }).catch(() => {});

  return { ...shareLink, url, accessCode };
}

// ============================================
// Revoke Share Link
// ============================================

// Soft revocation (Story 2.3): the row stays with `revokedAt`, so the share
// page answers "not found" and every signed URL for it answers 404. Who may
// revoke is decided by the caller through `can(actor, 'share.manage', { ownerId })`.
export async function getShareLinkOwner(id: string) {
  return prisma.shareLink.findUnique({ where: { id }, select: { id: true, createdById: true, revokedAt: true } });
}

export async function revokeShareLink(id: string, reason = 'revoked') {
  await prisma.shareLink.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return true;
}

// Moved to the share module so domain modules can call it (import direction).
export { revokeLinksForTargets } from '@/modules/share';
