import prisma from '@/lib/prisma';
import { afterCommit, channels } from '@/modules/realtime';

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
