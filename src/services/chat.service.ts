import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { handleMatchesUser, mentionHandles } from '../lib/mentions';
import { listActorsWithAccess } from '@/modules/auth';
import { afterCommit, channels } from '@/modules/realtime';
import { createNotification } from './notification.service';

type ChatInput = {
  projectId: string;
  senderId: string;
  message: string;
  referencedFileId?: string | null;
  kind?: string | null;
};

/**
 * Story 5.5: inserts a chat message with the next per-Project sequence in
 * one transaction (the counter bump rolls back with a failed insert), then
 * announces it on `project:<id>` only after the commit. New ids are UUID v7,
 * so history in (createdAt, id) order is the same for every reader.
 */
export async function insertChat(input: ChatInput) {
  return afterCommit(
    prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<{ chat_seq: bigint }[]>`
        UPDATE projects SET chat_seq = chat_seq + 1 WHERE id = ${input.projectId} RETURNING chat_seq`;
      if (!rows[0]) throw new Error('Project not found');
      return tx.projectChat.create({
        data: {
          id: uuidv7(),
          seq: rows[0].chat_seq,
          message: input.message,
          projectId: input.projectId,
          senderId: input.senderId,
          referencedFileId: input.referencedFileId || null,
          kind: input.kind ?? null,
        },
        include: { sender: true, project: true, referencedFile: true },
      });
    }),
    (chat) => ({ channels: [channels.project(chat.projectId)], event: { type: 'chat.created', id: chat.id, seq: Number(chat.seq) } }),
  );
}

/**
 * Stores a chat message and notifies only the users it mentions (Story 2.5):
 * "@Name" (display name without spaces) or "@emailLocalPart". Story 5.5:
 * candidates are the accounts with access to the Project
 * (`listActorsWithAccess`), never the sender. The caller validated the
 * project and the referenced file.
 */
export async function sendMessage(senderId: string, projectId: string, message: string, referencedFileId?: string) {
  const chat = await insertChat({ projectId, senderId, message, referencedFileId });

  const handles = mentionHandles(message);
  if (handles.length) {
    const candidates = (await listActorsWithAccess(projectId)).filter((u) => u.id !== senderId);
    // Never the email: without a name the bell shows a translated "Someone".
    const senderName = chat.sender?.name?.trim() || '';
    const projectTitle = chat.project?.title || '';
    const excerpt = message.slice(0, 80);
    for (const u of candidates) {
      if (!handles.some((h) => handleMatchesUser(h, u))) continue;
      createNotification({
        userId: u.id,
        type: 'chat_mention',
        projectId,
        // English fallback; the bell renders from type + data.
        title: `New message in ${projectTitle || 'a project'}`,
        body: `${senderName || 'Someone'}: ${excerpt}`,
        data: { projectId, chatId: chat.id, projectTitle, excerpt, ...(senderName ? { senderName } : {}) },
      }).catch(() => {});
    }
  }

  return chat;
}
