import prisma from '@/lib/prisma';
import { canViewProjects, type Actor } from '@/modules/auth';
import { afterCommit, channels } from '@/modules/realtime';
import { visibleNotifications } from '../lib/notificationAccess';

export type NotifType = 'upload_complete' | 'chat_mention' | 'file_shared' | 'project_created';

/**
 * Stores a notification and announces it on `user:<id>` after the insert.
 * Story 5.5: `projectId` (also kept in `data`) lets reads drop notifications
 * of a Project the reader can no longer view.
 */
export async function createNotification(data: {
  userId: string;
  type: NotifType;
  title: string;
  body: string;
  projectId?: string | null;
  data?: Record<string, string>;
}) {
  const projectId = data.projectId ?? data.data?.projectId ?? null;
  return afterCommit(
    prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        data: data.data || {},
        projectId: projectId || null,
      },
    }),
    // A notification has one event in its life: seq 1.
    (notif) => ({ channels: [channels.user(notif.userId)], event: { type: 'notification.created', id: notif.id, seq: 1 } }),
  );
}

const PAGE = 50;

/** Rows the reader may see: own, and of a Project that still exists and they can view. */
async function readable<T extends { projectId: string | null }>(actor: Actor, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map((r) => r.projectId).filter((p): p is string => !!p))];
  const viewable = await canViewProjects(actor, ids);
  return visibleNotifications(rows, viewable);
}

export async function getNotifications(actor: Actor, unreadOnly = false) {
  const rows = await prisma.notification.findMany({
    where: { userId: actor.id, ...(unreadOnly ? { read: false } : {}) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    // A few more than a page, so filtered rows rarely shorten it.
    take: PAGE * 2,
  });
  const results = (await readable(actor, rows)).slice(0, PAGE);
  return results.map((n) => ({
    ...n,
    data: typeof n.data === 'string' ? n.data : JSON.stringify(n.data),
  }));
}

/** One notification for its owner, or null when it is gone or no longer readable. */
export async function notificationFor(actor: Actor, id: string) {
  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row || row.userId !== actor.id) return null;
  const [visible] = await readable(actor, [row]);
  return visible ? { ...visible, data: typeof visible.data === 'string' ? visible.data : JSON.stringify(visible.data) } : null;
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  return true;
}

export async function unreadCount(actor: Actor) {
  const rows = await prisma.notification.findMany({ where: { userId: actor.id, read: false }, select: { id: true, projectId: true } });
  return (await readable(actor, rows)).length;
}
