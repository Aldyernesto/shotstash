import { v7 as uuidv7 } from 'uuid';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { afterCommit, channels } from '@/modules/realtime';

export type ChatInput = {
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
