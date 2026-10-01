/**
 * Project access (Story 5.5). There is no membership model yet: an account
 * may view a Project when the Project exists and `can(actor, 'project.view')`
 * (an active account with accountStatus ACTIVE). Every place that needs "who
 * may see this Project" asks here, so a membership model later changes one
 * file.
 *
 * Prisma is imported lazily: `index.ts` is also loaded by `node --test`
 * (through `withAuth.ts`), which cannot resolve the `@/` alias.
 */
import { can, type Actor } from './permissions.ts';

async function db() {
  return (await import('@/lib/prisma')).default;
}

export type ProjectMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  accountStatus: string;
  readOnly: boolean;
};

/**
 * Active accounts that may view the Project (none when it does not exist),
 * by name. `query` filters by name or email (contains, case-insensitive)
 * and `take` limits the rows, both in the database.
 */
export async function listActorsWithAccess(projectId: string, opts: { query?: string; take?: number } = {}): Promise<ProjectMember[]> {
  const prisma = await db();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) return [];
  const q = (opts.query ?? '').trim();
  const users = await prisma.user.findMany({
    where: {
      active: true,
      accountStatus: 'ACTIVE',
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { email: { contains: q, mode: 'insensitive' as const } }] }
        : {}),
    },
    select: { id: true, name: true, email: true, role: true, active: true, accountStatus: true, readOnly: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    ...(opts.take ? { take: opts.take } : {}),
  });
  return users.filter((u) => can(u, 'project.view'));
}

/** The ids among `projectIds` that exist and `actor` may view. */
export async function canViewProjects(actor: Actor | null | undefined, projectIds: readonly string[]): Promise<Set<string>> {
  if (!projectIds.length || !can(actor, 'project.view')) return new Set();
  const prisma = await db();
  const rows = await prisma.project.findMany({ where: { id: { in: [...projectIds] } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export async function canViewProject(actor: Actor | null | undefined, projectId: string): Promise<boolean> {
  return (await canViewProjects(actor, [projectId])).has(projectId);
}
