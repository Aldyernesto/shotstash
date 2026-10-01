import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

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
