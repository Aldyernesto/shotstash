// Public surface of the auth module.
export {
  ACTIONS,
  MATRIX,
  ROLES,
  assertCan,
  assertCanWriteSelf,
  can,
  canManageUser,
  forbidden,
  isAdminRole,
  isWriteAction,
  permissionsFor,
  unauthenticated,
} from './permissions.ts';
export type { Action, Actor, Resource, Role, UserChange, UserTarget } from './permissions.ts';
// Story 5.5: who may view a Project (lazy database access).
export { canViewProject, canViewProjects, listActorsWithAccess } from './access.ts';
export type { ProjectMember } from './access.ts';
