/**
 * The one permission function (Story 2.4).
 *
 * Every write in resolvers and routes calls `can()` / `assertCan()`, and the
 * UI only reads `me.permissions` (from `permissionsFor()`), so the rules live
 * here and nowhere else.
 *
 * Matrix (PRD):
 *   project.view, media.download, discussion.use ... every role
 *   upload, section.create, share.manage,
 *   item.move, item.trash, trash.view ............. every role except VIEWER
 *   trash.purge .................................... SUPER_ADMIN, ADMIN
 *   pipeline.trigger ............................... SUPER_ADMIN, ADMIN, EDITOR
 *   users.view (read), users.manage ................ SUPER_ADMIN, ADMIN
 *   instance.configure ............................. SUPER_ADMIN
 *
 * Cross-cutting rules:
 *   - only active accounts with accountStatus ACTIVE get anything;
 *   - there is no project membership model yet: an allowed actor sees every
 *     project;
 *   - `readOnly` accounts are denied every write action;
 *   - resource ownership: a non-admin manages only share links they created,
 *     and an upload session belongs to its uploader only.
 *
 * This file is imported by `node --test` through type stripping: keep it free
 * of path aliases, enums and other syntax that needs a compiler.
 */

import { GraphQLError } from 'graphql';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'FIELD_CREW' | 'EDITOR' | 'VIEWER';

export const ROLES: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'FIELD_CREW', 'EDITOR', 'VIEWER'];

export const ACTIONS = [
  'project.view',
  'media.download',
  'upload',
  'section.create',
  'share.manage',
  'item.move',
  'item.trash',
  'trash.purge',
  'trash.view',
  'pipeline.trigger',
  'discussion.use',
  'users.view',
  'users.manage',
  'instance.configure',
] as const;

export type Action = (typeof ACTIONS)[number];

/** Actions that only read. Everything else is a write and is denied to read-only accounts. */
const READ_ACTIONS: ReadonlySet<Action> = new Set<Action>(['project.view', 'media.download', 'trash.view', 'users.view']);

const ALL: readonly Role[] = ROLES;
const NOT_VIEWER: readonly Role[] = ['SUPER_ADMIN', 'ADMIN', 'FIELD_CREW', 'EDITOR'];
const ADMINS: readonly Role[] = ['SUPER_ADMIN', 'ADMIN'];

export const MATRIX: Readonly<Record<Action, readonly Role[]>> = {
  'project.view': ALL,
  'media.download': ALL,
  'discussion.use': ALL,
  upload: NOT_VIEWER,
  'section.create': NOT_VIEWER,
  'share.manage': NOT_VIEWER,
  'item.move': NOT_VIEWER,
  'item.trash': NOT_VIEWER,
  'trash.view': NOT_VIEWER,
  'trash.purge': ADMINS,
  'pipeline.trigger': ['SUPER_ADMIN', 'ADMIN', 'EDITOR'],
  'users.view': ADMINS,
  'users.manage': ADMINS,
  'instance.configure': ['SUPER_ADMIN'],
};

export type Actor = {
  id: string;
  role: Role | string;
  active: boolean;
  accountStatus?: string | null;
  readOnly?: boolean | null;
};

/** Optional resource facts. `ownerId` is the creator of a share link or upload session. */
export type Resource = {
  ownerId?: string | null;
};

export function isWriteAction(action: Action): boolean {
  return !READ_ACTIONS.has(action);
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

function isEnabled(actor: Actor | null | undefined): actor is Actor {
  if (!actor || !actor.active) return false;
  return (actor.accountStatus ?? 'ACTIVE') === 'ACTIVE';
}

export function can(actor: Actor | null | undefined, action: Action, resource?: Resource | null): boolean {
  if (!isEnabled(actor)) return false;
  const allowed = MATRIX[action];
  if (!allowed || !allowed.includes(actor.role as Role)) return false;
  if (actor.readOnly && isWriteAction(action)) return false;

  if (resource && resource.ownerId !== undefined) {
    if (action === 'upload' && resource.ownerId !== actor.id) return false;
    if (action === 'share.manage' && !isAdminRole(actor.role) && resource.ownerId !== actor.id) return false;
  }
  return true;
}

/** Every action the actor may perform (no resource). Feeds `me.permissions`. */
export function permissionsFor(actor: Actor | null | undefined): Action[] {
  return ACTIONS.filter((a) => can(actor, a));
}

export function forbidden(message = 'Forbidden'): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'FORBIDDEN' } });
}

export function unauthenticated(message = 'Unauthorized'): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'UNAUTHENTICATED' } });
}

/** Throws a GraphQL error with `extensions.code = 'FORBIDDEN'` when `can()` is false. */
export function assertCan(
  actor: Actor | null | undefined,
  action: Action,
  resource?: Resource | null,
): asserts actor is Actor {
  if (!actor) throw unauthenticated();
  if (!can(actor, action, resource)) throw forbidden(`Forbidden: ${action}`);
}

/** A write by an account on itself (profile, notifications): only read-only accounts are denied. */
export function assertCanWriteSelf(actor: Actor | null | undefined): asserts actor is Actor {
  if (!actor) throw unauthenticated();
  if (!actor.active || actor.readOnly) throw forbidden('Forbidden: read-only account');
}

export type UserChange =
  | { kind: 'role'; role: string }
  | { kind: 'approve'; role: string }
  | { kind: 'create'; role: string }
  | { kind: 'reject' }
  | { kind: 'deactivate' }
  | { kind: 'reactivate' }
  | { kind: 'password' }
  | { kind: 'delete' };

export type UserTarget = { id: string; role: string } | null;

/**
 * User-management target guard.
 *   - needs `users.manage`;
 *   - only a super admin may touch a super admin or grant the SUPER_ADMIN role;
 *   - the last super admin cannot demote or deactivate themselves;
 *   - password reset and deletion never target oneself or a super admin.
 */
export function canManageUser(
  actor: Actor | null | undefined,
  target: UserTarget,
  change: UserChange,
  superAdminCount: number,
): boolean {
  if (!can(actor, 'users.manage')) return false;
  const a = actor as Actor;
  const actorIsSuper = a.role === 'SUPER_ADMIN';

  const grants = 'role' in change ? String(change.role) : null;
  if (grants !== null && !(ROLES as readonly string[]).includes(grants)) return false;
  if (grants === 'SUPER_ADMIN' && !actorIsSuper) return false;

  if (change.kind === 'create') return true;
  if (!target) return false;

  const targetIsSuper = target.role === 'SUPER_ADMIN';
  if (targetIsSuper && !actorIsSuper) return false;

  if (change.kind === 'password' || change.kind === 'delete') {
    return target.id !== a.id && !targetIsSuper;
  }

  // `approve` sets a role too, so it demotes exactly like `role`.
  const demotes = (change.kind === 'role' || change.kind === 'approve') && targetIsSuper && grants !== 'SUPER_ADMIN';
  const disables = (change.kind === 'deactivate' || change.kind === 'reject') && targetIsSuper;
  if ((demotes || disables) && superAdminCount <= 1) return false;

  return true;
}
