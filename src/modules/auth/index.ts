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
