/**
 * UI gates (Stories 2.18 / 2.4).
 *
 * The rules live on the server in `src/modules/auth/permissions.ts`
 * (`can()`); the UI reads `me.permissions` (cached on the AuthContext user)
 * and never re-implements role rules. Every gate below answers "is this
 * action in the user's permission list".
 *
 *   New Project / New Section ............... section.create
 *   Upload (button, drop, "Upload to") ...... upload
 *   Rename, Move, Copy, drag-move ........... item.move
 *   Move to Trash, Restore .................. item.trash
 *   Trash page .............................. trash.view
 *   Delete Forever (purge) .................. trash.purge
 *   Share ................................... share.manage
 *   Admin tools and Admin Panel ............. users.manage
 *
 * Contract kept from Story 2.18: a denied action is NOT rendered (no
 * disabled twin, no hidden Tab stop). This is a display layer; the server
 * enforces the same rules on every write.
 *
 * Role label helpers at the end stay role-based: they name a role, they do
 * not grant anything.
 */

export type MamRole = "SUPER_ADMIN" | "ADMIN" | "FIELD_CREW" | "EDITOR" | "VIEWER";

/** Bentuk masukan yang diterima: objek user, string role, atau kosong. */
export type RoleLike = { role?: string | null } | string | null | undefined;

function roleOf(subject: RoleLike): string | null {
  if (!subject) return null;
  if (typeof subject === "string") return subject;
  return subject.role ?? null;
}

/* ------------------------------------------------------------------ */
/* Role identity (labels and target display only, never a gate)        */
/* ------------------------------------------------------------------ */

export function isSuperAdmin(subject: RoleLike): boolean {
  return roleOf(subject) === "SUPER_ADMIN";
}

/* ------------------------------------------------------------------ */
/* Permission gates                                                    */
/* ------------------------------------------------------------------ */

/** A user object carrying `permissions` from `me`. */
export type PermissionSubject = { permissions?: readonly string[] | null } | null | undefined;

export function hasPermission(subject: PermissionSubject, action: string): boolean {
  return !!subject?.permissions?.includes(action);
}

/** "+ New Project" and "+ New Folder" (New Section). */
export function canCreateProject(subject: PermissionSubject): boolean {
  return hasPermission(subject, "section.create");
}

/** "Upload Files", "Upload to {Section}", and dropping files from the computer. */
export function canUpload(subject: PermissionSubject): boolean {
  return hasPermission(subject, "upload");
}

/** Rename, "Move to...", "Copy to...", drag-to-move. */
export function canMove(subject: PermissionSubject): boolean {
  return hasPermission(subject, "item.move");
}

/** "Move to Trash" (single and bulk) and Restore. */
export function canManageTrash(subject: PermissionSubject): boolean {
  return hasPermission(subject, "item.trash");
}

/** The Trash page. */
export function canViewTrash(subject: PermissionSubject): boolean {
  return hasPermission(subject, "trash.view");
}

/** "Delete Forever" in the Trash, and deleting a whole Project. */
export function canPurgeTrash(subject: PermissionSubject): boolean {
  return hasPermission(subject, "trash.purge");
}

/** Create and revoke share links. */
export function canShare(subject: PermissionSubject): boolean {
  return hasPermission(subject, "share.manage");
}

/** Admin tools in the nav. */
export function canSeeAdminTools(subject: PermissionSubject): boolean {
  return hasPermission(subject, "users.manage");
}

/** Admin Panel (user management). */
export function canOpenAdminPanel(subject: PermissionSubject): boolean {
  return hasPermission(subject, "users.manage");
}

/* ------------------------------------------------------------------ */
/* Tampilan role (bukan gerbang, tetapi sumber katanya juga satu)      */
/* ------------------------------------------------------------------ */

const INITIALS: Record<string, string> = {
  SUPER_ADMIN: "SA",
  ADMIN: "AD",
  FIELD_CREW: "FC",
  VIEWER: "VW",
  EDITOR: "ED",
};

const LABELS: Record<string, string> = {
  SUPER_ADMIN: "SUPER ADMIN",
  ADMIN: "ADMIN",
  FIELD_CREW: "CREW",
  VIEWER: "VIEWER",
  EDITOR: "EDITOR",
};

/** Inisial dua huruf untuk `avatar-pill`. */
export function roleInitials(subject: RoleLike): string {
  return INITIALS[roleOf(subject) ?? ""] ?? "ED";
}

/** Kata role yang ditulis di bawah nama pada `avatar-pill`. */
export function roleLabel(subject: RoleLike): string {
  return LABELS[roleOf(subject) ?? ""] ?? "EDITOR";
}

/* Story 3.16: `role-chip` percakapan menulis label role UTUH KAPITAL —
   "FIELD CREW", bukan "CREW" yang dipakai `avatar-pill` (di sana ruangnya
   selebar satu kolom kecil). Dua peta, satu berkas: kata rolenya tetap
   tidak pernah dikarang di layar. */
const CHIP_LABELS: Record<string, string> = {
  SUPER_ADMIN: "SUPER ADMIN",
  ADMIN: "ADMIN",
  FIELD_CREW: "FIELD CREW",
  EDITOR: "EDITOR",
  VIEWER: "VIEWER",
};

/** Kata role untuk `role-chip` di kartu pesan. */
export function roleChipLabel(subject: RoleLike): string {
  const role = roleOf(subject) ?? "";
  return CHIP_LABELS[role] ?? role.replace(/_/g, " ").toUpperCase();
}
