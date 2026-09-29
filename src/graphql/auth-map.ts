/**
 * Story 2.1: every root GraphQL field declares its auth mode.
 *
 *   public   no session needed (the resolver may still use one when present)
 *   session  a valid Bearer session of an active user, else UNAUTHENTICATED
 *
 * `action` names the `can()` action the resolver enforces (or `self` for
 * writes on the caller's own account). It feeds
 * `docs/security/route-matrix.md`; enforcement lives in the resolvers.
 *
 * `applyAuthMap()` wraps the resolvers and refuses to start when a resolver
 * has no entry here; `scripts/route-coverage.test.mjs` fails when a schema
 * field or resolver is missing from this map.
 *
 * Pure data (no imports with side effects): tests import it directly.
 */

export type FieldAuthMode = 'public' | 'session';

export type FieldAuth = { auth: FieldAuthMode; action?: string };

export const AUTH_MAP: Record<'Query' | 'Mutation' | 'Subscription', Record<string, FieldAuth>> = {
  Query: {
    me: { auth: 'public' },
    passwordResetAvailable: { auth: 'public' },
    pendingUsers: { auth: 'session', action: 'users.manage' },
    users: { auth: 'session', action: 'users.manage' },
    storageStats: { auth: 'session', action: 'instance.configure' },
    projects: { auth: 'session', action: 'project.view' },
    project: { auth: 'session', action: 'project.view' },
    folder: { auth: 'session', action: 'project.view' },
    searchFiles: { auth: 'session', action: 'project.view' },
    searchFolders: { auth: 'session', action: 'project.view' },
    shareLinks: { auth: 'session', action: 'share.manage' },
    shareLinksForTarget: { auth: 'session', action: 'share.manage' },
    uploadSession: { auth: 'session', action: 'upload' },
    checkDuplicates: { auth: 'session', action: 'upload' },
    allTrashedFiles: { auth: 'session', action: 'trash.view' },
    allTrashedFolders: { auth: 'session', action: 'trash.view' },
    notifications: { auth: 'session', action: 'self' },
    unreadNotificationCount: { auth: 'session', action: 'self' },
  },
  Mutation: {
    login: { auth: 'public' },
    logout: { auth: 'public' },
    register: { auth: 'public', action: 'users.manage (when signed in)' },
    googleAuth: { auth: 'public' },
    requestPasswordReset: { auth: 'public' },
    verifyPasswordResetCode: { auth: 'public' },
    completePasswordReset: { auth: 'public' },
    updateProfile: { auth: 'session', action: 'self' },
    completeOnboarding: { auth: 'session', action: 'self' },
    markNotificationsRead: { auth: 'session', action: 'self' },
    createProject: { auth: 'session', action: 'section.create' },
    updateProject: { auth: 'session', action: 'item.move' },
    deleteProject: { auth: 'session', action: 'trash.purge' },
    createFolder: { auth: 'session', action: 'section.create' },
    renameFolder: { auth: 'session', action: 'item.move' },
    moveFile: { auth: 'session', action: 'item.move' },
    copyFile: { auth: 'session', action: 'upload' },
    moveFolder: { auth: 'session', action: 'item.move' },
    initiateUpload: { auth: 'session', action: 'upload' },
    completeUpload: { auth: 'session', action: 'upload' },
    cancelUpload: { auth: 'session', action: 'upload' },
    createShareLink: { auth: 'session', action: 'share.manage' },
    revokeShareLink: { auth: 'session', action: 'share.manage' },
    sendMessage: { auth: 'session', action: 'discussion.use' },
    moveToTrash: { auth: 'session', action: 'item.trash' },
    restoreFile: { auth: 'session', action: 'item.trash' },
    permanentDelete: { auth: 'session', action: 'trash.purge' },
    moveFolderToTrash: { auth: 'session', action: 'item.trash' },
    restoreFolder: { auth: 'session', action: 'item.trash' },
    permanentDeleteFolder: { auth: 'session', action: 'trash.purge' },
    approveUser: { auth: 'session', action: 'users.manage' },
    rejectUser: { auth: 'session', action: 'users.manage' },
    updateUserRole: { auth: 'session', action: 'users.manage' },
    deactivateUser: { auth: 'session', action: 'users.manage' },
    reactivateUser: { auth: 'session', action: 'users.manage' },
    adminSetPassword: { auth: 'session', action: 'users.manage' },
    deleteUser: { auth: 'session', action: 'users.manage' },
  },
  Subscription: {
    uploadProgress: { auth: 'session', action: 'upload' },
    chatMessages: { auth: 'session', action: 'project.view' },
    notificationReceived: { auth: 'session', action: 'self' },
  },
};

export const ROOT_TYPES = ['Query', 'Mutation', 'Subscription'] as const;
