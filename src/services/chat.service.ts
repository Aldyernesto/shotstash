import prisma from '../lib/prisma';
import { pubsub } from '../lib/pubsub';
import { bigIntToNumber } from '../lib/bigint';
import { handleMatchesUser, mentionHandles } from '../lib/mentions';
import { can } from '@/modules/auth';
import { createNotification } from './notification.service';

/**
 * Stores a chat message and notifies only the users it mentions (Story 2.5):
 * "@Name" (display name without spaces) or "@emailLocalPart". A mentioned
 * user is notified only when active, ACTIVE, allowed to view the project and
 * not the sender. The caller validated the project and the referenced file.
 */
export async function sendMessage(senderId: string, projectId: string, message: string, referencedFileId?: string) {
  const chat = await prisma.projectChat.create({
    data: { message, projectId, senderId, referencedFileId: referencedFileId || null },
    include: { sender: true, project: true, referencedFile: true },
  });

  pubsub.publish(`CHAT_MESSAGES_${projectId}`, { chatMessages: bigIntToNumber(chat) }).catch(() => {});

  const handles = mentionHandles(message);
  if (handles.length) {
    const candidates = await prisma.user.findMany({
      where: { active: true, accountStatus: 'ACTIVE', id: { not: senderId } },
      select: { id: true, name: true, email: true, role: true, active: true, accountStatus: true, readOnly: true },
    });
    const senderName = chat.sender?.name || 'Someone';
    for (const u of candidates) {
      if (!handles.some((h) => handleMatchesUser(h, u))) continue;
      if (!can(u, 'project.view')) continue;
      createNotification({
        userId: u.id,
        type: 'chat_mention',
        title: `New message in ${chat.project?.title || 'Project'}`,
        body: `${senderName}: ${message.slice(0, 80)}`,
        data: { projectId, chatId: chat.id },
      }).catch(() => {});
    }
  }

  return chat;
}
