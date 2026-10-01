import prisma from '@/lib/prisma';
import { can, canViewProjects, type Actor } from '@/modules/auth';
import { config } from '@/lib/config';
import { visibleNotifications } from '../lib/notificationAccess';

// The writer lives in the activity module so domain modules can call it.
export { createNotification } from '@/modules/activity';
export type { NotifType } from '@/modules/activity';

const PAGE = 50;

/** Story 5.5: mention notifications are hidden while discussion is off. */
function hiddenTypes(): string[] {
  return config().features.discussion ? [] : ['chat_mention'];
}

/** Rows the reader may see: own, and of a Project that still exists and they can view. */
async function readable<T extends { projectId: string | null }>(actor: Actor, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map((r) => r.projectId).filter((p): p is string => !!p))];
  const viewable = await canViewProjects(actor, ids);
  return visibleNotifications(rows, viewable);
}

const asText = <T extends { data: unknown }>(n: T) => ({ ...n, data: typeof n.data === 'string' ? n.data : JSON.stringify(n.data) });

/** The newest 50 readable notifications, reading further pages until 50 are found or none are left. */
export async function getNotifications(actor: Actor, unreadOnly = false) {
  const hidden = hiddenTypes();
  type Row = Awaited<ReturnType<typeof prisma.notification.findFirstOrThrow>>;
  const out: Row[] = [];
  let cursor: { createdAt: Date; id: string } | null = null;
  for (;;) {
    const page: Row[] = await prisma.notification.findMany({
      where: {
        userId: actor.id,
        ...(unreadOnly ? { read: false } : {}),
        ...(hidden.length ? { type: { notIn: hidden } } : {}),
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE,
    });
    out.push(...(await readable(actor, page)));
    if (out.length >= PAGE || page.length < PAGE) break;
    const last: Row = page[page.length - 1];
    cursor = { createdAt: last.createdAt, id: last.id };
  }
  return out.slice(0, PAGE).map(asText);
}

/** One notification for its owner, or null when it is gone or no longer readable. */
export async function notificationFor(actor: Actor, id: string) {
  const row = await prisma.notification.findUnique({ where: { id } });
  if (!row || row.userId !== actor.id || hiddenTypes().includes(row.type)) return null;
  const [visible] = await readable(actor, [row]);
  return visible ? asText(visible) : null;
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
  return true;
}

/** Unread readable notifications, counted in SQL with the same visibility rule as reads. */
export async function unreadCount(actor: Actor) {
  const canView = can(actor, 'project.view');
  const hidden = hiddenTypes();
  const rows = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM notifications n
    WHERE n."userId" = ${actor.id} AND n.read = false
      AND NOT (n.type = ANY(${hidden}::text[]))
      AND (n.project_id IS NULL OR (${canView} AND EXISTS (SELECT 1 FROM projects p WHERE p.id = n.project_id)))`;
  return rows[0]?.n ?? 0;
}
