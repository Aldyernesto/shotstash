import prisma from '@/lib/prisma';
import { pubsub } from '../lib/pubsub';

export type NotifType = 'upload_complete' | 'chat_mention' | 'file_shared' | 'project_created';

export async function createNotification(data: {
  userId: string;
  type: NotifType;
  title: string;
  body: string;
  data?: Record<string, string>;
}) {
  const notif = await prisma.notification.create({ data: {
    userId: data.userId, type: data.type, title: data.title, body: data.body, data: data.data || {},
  }});
  pubsub.publish(`NOTIFICATIONS_${data.userId}`, { newNotification: notif }).catch(() => {});


  return notif;
}

export async function getNotifications(userId: string, unreadOnly = false) {
  const results = await prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return results.map(n => ({
    ...n,
    data: typeof n.data === 'string' ? n.data : JSON.stringify(n.data),
  }));
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  return true;
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}
