import prisma from '../lib/prisma';
import { pubsub } from '../lib/pubsub';
import { bigIntToNumber } from '../lib/bigint';
import { createNotification } from './notification.service';

export async function sendMessage(senderId: string, projectId: string, message: string, referencedFileId?: string) {
  const chat = await prisma.projectChat.create({
    data: { message, projectId, senderId, referencedFileId: referencedFileId || null },
    include: { sender: true, project: true, referencedFile: true },
  });

  pubsub.publish(`CHAT_MESSAGES_${projectId}`, { chatMessages: bigIntToNumber(chat) }).catch(() => {});

  // Notify project members about new chat
  const members = await prisma.user.findMany({ select: { id: true } });
  const senderName = chat.sender?.name || 'Someone';
  for (const m of members) {
    if (m.id === senderId) continue; // don't notify sender
    createNotification({
      userId: m.id, type: 'chat_mention',
      title: `New message in ${chat.project?.title || 'Project'}`,
      body: `${senderName}: ${message.slice(0, 80)}`,
      data: { projectId, chatId: chat.id },
    }).catch(() => {});
  }

  return chat;
}
