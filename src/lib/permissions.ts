/**
 * Story 2.18 — SATU sumber kebenaran gerbang role untuk ruang kerja berkas.
 *
 * ============================================================
 * TABEL KEPUTUSAN (ditulis sekali, di sini, dan tidak di tempat lain)
 * ============================================================
 *   Lihat / Preview / Share ................ semua role
 *   New Project ............................ SUPER_ADMIN, ADMIN, FIELD_CREW
 *   New Section ............................ SUPER_ADMIN, ADMIN, FIELD_CREW
 *   Upload Files / Upload to {Section} ..... SUPER_ADMIN, ADMIN, FIELD_CREW
 *   Seret file dari komputer (drop) ........ SUPER_ADMIN, ADMIN, FIELD_CREW
 *   Rename ................................. SUPER_ADMIN, ADMIN
 *   Move to… / Copy to… / seret-pindah ..... SUPER_ADMIN, ADMIN
 *   Delete Project ......................... SUPER_ADMIN, ADMIN
 *   Move to Trash (satuan & massal) ........ SUPER_ADMIN, ADMIN
 *   Trash management (halaman Trash) ....... SUPER_ADMIN, ADMIN
 *   Admin tools ............................ SUPER_ADMIN, ADMIN
 *   Admin Panel ............................ SUPER_ADMIN
 *
 * VIEWER: `canUpload` bernilai salah; hanya lihat, preview, unduh, dan share.
 *
 * ============================================================
 * KONTRAK
 * ============================================================
 * 1. Satu fungsi murni per gerbang, `user.role` sebagai SATU-SATUNYA
 *    masukan. Tidak ada state, tidak ada fetch, tidak ada React.
 * 2. Aksi yang tidak boleh **tidak dirender sama sekali**. Modul ini
 *    sengaja TIDAK menyediakan jalur "render tetapi nonaktif" — tidak ada
 *    `disabled`, `aria-disabled`, atau tombol redup yang menolak setelah
 *    ditekan. Karena elemennya tidak ada di DOM, tidak ada perhentian Tab
 *    tersembunyi dan urutan Tab tetap mengikuti urutan baca.
 * 3. Ini LAPISAN TAMPILAN, bukan pengganti otorisasi server. Resolver,
 *    `typeDefs`, dan `prisma/schema.prisma` tidak diubah oleh story ini;
 *    membuka tujuan yang tidak berhak lewat URL langsung tetap dialihkan
 *    ke `/dashboard` seperti sekarang.
 * 4. Tidak ada aturan hak akses BARU dan tidak ada yang dilonggarkan
 *    dibanding perilaku sebelum story ini.
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
/* Gerbang identitas role                                              */
/* ------------------------------------------------------------------ */

export function isSuperAdmin(subject: RoleLike): boolean {
  return roleOf(subject) === "SUPER_ADMIN";
}

/** SUPER_ADMIN ATAU ADMIN — pasangan "admin-like" yang dipakai tabel di atas. */
export function isAdmin(subject: RoleLike): boolean {
  const role = roleOf(subject);
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

export function isCrew(subject: RoleLike): boolean {
  return roleOf(subject) === "FIELD_CREW";
}

export function isEditor(subject: RoleLike): boolean {
  return roleOf(subject) === "EDITOR";
}

export function isViewer(subject: RoleLike): boolean {
  return roleOf(subject) === "VIEWER";
}

/* ------------------------------------------------------------------ */
/* Gerbang aksi                                                        */
/* ------------------------------------------------------------------ */

/** "+ New Project" dan "+ New Folder" (New Section). */
export function canCreateProject(subject: RoleLike): boolean {
  return isAdmin(subject) || isCrew(subject);
}

/** "Upload Files", "Upload to {Section}", dan seret file dari komputer. */
export function canUpload(subject: RoleLike): boolean {
  return isAdmin(subject) || isCrew(subject);
}

/** Rename, "Move to…", "Copy to…", seret-untuk-memindahkan, Delete Project. */
export function canMove(subject: RoleLike): boolean {
  return isAdmin(subject);
}

/** "Move to Trash" satuan maupun massal, dan halaman Trash. */
export function canManageTrash(subject: RoleLike): boolean {
  return isAdmin(subject);
}

/** Admin tools. */
export function canSeeAdminTools(subject: RoleLike): boolean {
  return isAdmin(subject);
}

/** Admin Panel. */
export function canOpenAdminPanel(subject: RoleLike): boolean {
  return isSuperAdmin(subject);
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
