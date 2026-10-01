import { assignMentionHandles, mentionHandles, resolveMentionHandle } from '../lib/mentions';
import { listActorsWithAccess } from '@/modules/auth';
import { createNotification, insertChat } from '@/modules/activity';

// The writer lives in the activity module so domain modules can call it.
export { insertChat } from '@/modules/activity';

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
    // One typed handle names at most one account (an ambiguous one names none).
    const assigned = assignMentionHandles(candidates);
    const named = new Map<string, (typeof candidates)[number]>();
    for (const h of handles) {
      const u = resolveMentionHandle(h, candidates, assigned);
      if (u) named.set(u.id, u);
    }
    for (const u of named.values()) {
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
