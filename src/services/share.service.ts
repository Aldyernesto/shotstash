// Shotstash Share Link Service

import { customAlphabet } from 'nanoid';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { createNotification } from './notification.service';
import { generateAccessCode, hashAccessCode } from '@/modules/share';

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
  const targets = [data.fileId, data.folderId, data.projectId].filter(Boolean);
  if (targets.length !== 1) throw new Error('Exactly one target is required: fileId, folderId or projectId');

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

  const url = `${BASE_URL}/s/${slug}`;

  // Only the creator is notified: other users may not be allowed to see the target.
  const name = data.fileId ? (shareLink.file?.originalName || 'a file') : 'a folder';
  createNotification({
    userId: data.createdById, type: 'file_shared',
    title: 'File Shared', body: `New share link created for ${name}`,
    data: { slug, fileId: data.fileId || '' },
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

/**
 * Revokes every live link that points at these targets. Called before any
 * hard delete: the target foreign keys are ON DELETE SET NULL and the
 * `share_links_exactly_one_target` CHECK only lets revoked links lose their target.
 */
export async function revokeLinksForTargets(
  targets: { fileIds?: string[]; folderIds?: string[]; projectIds?: string[] },
  reason = 'target_deleted',
  db: Pick<typeof prisma, 'shareLink'> | Prisma.TransactionClient = prisma,
) {
  const or = [
    targets.fileIds?.length ? { fileId: { in: targets.fileIds } } : null,
    targets.folderIds?.length ? { folderId: { in: targets.folderIds } } : null,
    targets.projectIds?.length ? { projectId2: { in: targets.projectIds } } : null,
  ].filter(Boolean) as object[];
  if (!or.length) return 0;
  const res = await db.shareLink.updateMany({
    where: { revokedAt: null, OR: or },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return res.count;
}
