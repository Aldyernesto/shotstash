// Shotstash — GraphQL Resolvers
// Layer 2: Core Business logic wrapper

import { createHash, randomUUID } from 'crypto';
import * as AuthService from '../services/auth.service';
import * as UploadService from '../services/upload.service';
import * as ShareService from '../services/share.service';
import * as FolderService from '../services/folder.service';
import * as ChatService from '../services/chat.service';
import * as NotifService from '../services/notification.service';
import * as GoogleAuth from '../services/google-auth.service';
import * as ProjectService from '../services/project.service';
import * as PasswordReset from '../services/password-reset.service';
import prisma from '../lib/prisma';
import { esClient } from '../lib/elasticsearch';
import { pubsub } from '../lib/pubsub';
import { isRenderableImageUrl, mediaUrl } from '../lib/mediaUrls';
import {
  assertCan,
  assertCanWriteSelf,
  can,
  canManageUser,
  forbidden,
  isAdminRole,
  permissionsFor,
  type Actor,
  type UserChange,
} from '@/modules/auth';
import { applyAuthMap } from './withAuth';
import { loginLimit } from '../lib/rateLimit';
import { GraphQLError } from 'graphql';

// Same throttle as REST login (10 per 15 min per IP, plus per email for passwords).
async function assertLoginRate(context: GraphQLContext, email?: string | null) {
  const retryAfter = await loginLimit(context.ip, email);
  if (retryAfter !== null) {
    throw new GraphQLError('Too many attempts', { extensions: { code: 'RATE_LIMITED', retryAfter } });
  }
}

export interface GraphQLContext {
  req: Request;
  res?: Response;
  /** Id of the active signed-in user (same as actor.id). */
  userId?: string;
  sessionId?: string;
  /** Bearer token of this request, used by logout. */
  sessionToken?: string;
  /** Resolved from the Bearer session; null or undefined when signed out or inactive. */
  actor?: Actor | null;
  // IP klien (Cloudflare/nginx header) — dipakai limit per IP reset password.
  ip?: string;
}

const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'wmv', 'flv'];
const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp', 'tiff', 'tif', 'raw', 'cr2', 'nef', 'dng', 'arw', 'orf', 'rw2'];
const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'json', 'xml', 'zip', 'rar'];


type MamRole = 'SUPER_ADMIN' | 'ADMIN' | 'FIELD_CREW' | 'EDITOR' | 'VIEWER';
const PUBLIC_SIGNUP_ROLES: MamRole[] = ['EDITOR', 'FIELD_CREW', 'VIEWER'];
const TEAM_CREATE_ROLES: MamRole[] = ['ADMIN', 'FIELD_CREW', 'EDITOR', 'VIEWER'];

// Story 2.4: `applyAuthMap` guarantees an active actor on `session` fields.
function actorOf(context: GraphQLContext): Actor {
  if (!context.actor) throw forbidden();
  return context.actor;
}

async function superAdminCount(): Promise<number> {
  return prisma.user.count({ where: { role: 'SUPER_ADMIN', active: true } });
}

// User-management target guard (Story 2.4): throws FORBIDDEN when the change is not allowed.
async function assertManageUser(context: GraphQLContext, targetId: string, change: UserChange) {
  const actor = actorOf(context);
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } });
  if (!target) throw new Error('User tidak ditemukan.');
  if (!canManageUser(actor, target, change, await superAdminCount())) {
    throw forbidden(`Forbidden: users.manage (${change.kind})`);
  }
  return target;
}

// Every folder id in a subtree, trashed or not (hard deletes revoke links first).
async function allSubtreeFolderIds(rootId: string): Promise<string[]> {
  const ids = [rootId];
  let frontier = [rootId];
  let guard = 0;
  while (frontier.length && guard++ < 64) {
    const children = await prisma.folder.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}

async function assertUploadOwner(context: GraphQLContext, sessionId: string) {
  const actor = actorOf(context);
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId }, select: { uploadedById: true } });
  if (!session) throw new Error('Upload session tidak ditemukan');
  assertCan(actor, 'upload', { ownerId: session.uploadedById });
}
// Aksi admin berisiko (reset password / hapus akun): target tidak boleh diri sendiri.
// Target SUPER_ADMIN & user tidak ditemukan ditolak di AuthService (AdminActionError).
function adminTargetError(callerId: string, targetId: string): string | null {
  if (!targetId) return 'User tidak ditemukan.';
  if (targetId === callerId) return 'Tidak bisa melakukan aksi ini pada akun sendiri.';
  return null;
}
function adminActionFailure(action: string, error: unknown) {
  if (error instanceof AuthService.AdminActionError) {
    return { success: false, message: error.message, password: null };
  }
  // Jangan log argumen mutasi (bisa berisi password) — cukup pesan error.
  console.error(`[${action}] gagal:`, (error as Error)?.message);
  return { success: false, message: 'Gagal memproses permintaan. Coba lagi.', password: null };
}
// Jejak audit aksi admin berisiko. JANGAN pernah sertakan password.
function auditAdminAction(action: string, actor: { id: string; email: string } | null, targetEmail: string) {
  console.warn(`[audit] action=${action} actorId=${actor?.id} actorEmail=${actor?.email} target=${targetEmail} at=${new Date().toISOString()}`);
}
// Hasil mutasi reset password. Error tak terduga → pesan generik; hanya error.message yang di-log
// (JANGAN log argumen mutasi: berisi kode/token/password).
function passwordResetFailure(action: string, error: unknown) {
  if (error instanceof PasswordReset.PasswordResetError) {
    return { success: false, message: error.message, resetToken: null, errorCode: error.code };
  }
  console.error(`[${action}] gagal:`, (error as Error)?.message);
  return { success: false, message: 'Gagal memproses permintaan. Coba lagi.', resetToken: null, errorCode: 'INTERNAL' };
}
function parseSignupAnswers(value: unknown) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return { raw: value }; }
}

function validateFileTypeForFolder(folderName: string, ext: string): string | null {
  const fname = folderName.toLowerCase();
  if (fname === 'video' && !VIDEO_EXTS.includes(ext)) {
    return `Folder Video hanya menerima file video (${VIDEO_EXTS.join(', ')}). File .${ext} ditolak.`;
  }
  if (fname === 'photo' && !PHOTO_EXTS.includes(ext)) {
    return `Folder Photo hanya menerima file gambar (${PHOTO_EXTS.join(', ')}). File .${ext} ditolak.`;
  }
  if (fname === 'dokumen' && !DOC_EXTS.includes(ext)) {
    return `Folder Dokumen hanya menerima file dokumen (${DOC_EXTS.join(', ')}). File .${ext} ditolak.`;
  }
  return null;
}

// Trace folder ancestry to find the root default folder type
async function getRootFolderType(folderId: string): Promise<string | null> {
  let current = await prisma.folder.findUnique({ where: { id: folderId } });
  while (current) {
    if (['Video', 'Photo', 'Dokumen'].includes(current.name)) {
      return current.name;
    }
    if (!current.parentId) break;
    current = await prisma.folder.findUnique({ where: { id: current.parentId } });
  }
  return null;
}

async function countFilesRecursive(folderId: string): Promise<number> {
  let count = await prisma.mediaFile.count({ where: { folderId, trashedAt: null } });
  const children = await prisma.folder.findMany({
    where: { parentId: folderId, trashedAt: null },
    select: { id: true },
  });
  for (const child of children) {
    count += await countFilesRecursive(child.id);
  }
  return count;
}

// ============================================
// Story 2.4: ringkasan isi per jenis + sampel Kartu Perwakilan harian
// (aditif; tanpa migrasi skema Prisma — angka & sampel dihitung on-the-fly)
// ============================================

// Ember jenis dari mimeType — SATU sumber untuk contentSummary & repFiles.
function kindFromMime(mimeType: string): 'photo' | 'video' | 'document' {
  if (mimeType.startsWith('image/')) return 'photo';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

// Tanggal Asia/Jakarta (YYYY-MM-DD) — seed harian dihitung di SERVER sehingga
// dua permintaan di hari yang sama dari perangkat/zona waktu berbeda melihat
// sampel yang identik (AC 2.4); en-CA memformat ISO YYYY-MM-DD.
function jakartaDatestamp(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// PRNG deterministik dari byte-hash (mulberry32) — acak tapi replikabel.
function seededRandomFrom(seedHex: string): () => number {
  const a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  let state = a;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sampel deterministik: k item dari daftar yang diurut total-stabil
// (createdAt asc + id tiebreak). Fisher–Yates parsial — k langkah pertama
// menentukan sampel; hasil urutannya pun deterministik.
function pickDeterministic<T>(items: T[], k: number, seedHex: string): T[] {
  const rand = seededRandomFrom(seedHex);
  const pool = items.slice();
  for (let i = 0; i < k && pool.length > 1; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k);
}

// Id seluruh Section di subtree (diri sendiri + keturunan non-trash) — pola
// rekursi countFilesRecursive; pemakaian: SATU groupBy untuk seluruh subtree.
async function collectFolderSubtreeIds(folderId: string): Promise<string[]> {
  const ids = [folderId];
  const children = await prisma.folder.findMany({
    where: { parentId: folderId, trashedAt: null },
    select: { id: true },
  });
  for (const child of children) {
    ids.push(...(await collectFolderSubtreeIds(child.id)));
  }
  return ids;
}

function summarizeCounts(rows: { mimeType: string; _count: { _all: number } }[]) {
  const summary = { photos: 0, videos: 0, documents: 0, total: 0 };
  for (const row of rows) {
    const n = row._count._all;
    if (row.mimeType.startsWith('image/')) summary.photos += n;
    else if (row.mimeType.startsWith('video/')) summary.videos += n;
    else summary.documents += n;
    summary.total += n;
  }
  return summary;
}

// Batas sampel dijepit di server (AC 2.4): Project maks 5, Folder maks 3.
const REPFILE_MAX = { project: 5, folder: 3 } as const;

// Bentuk RepFile dari baris mediaFile: sumber thumbnail = /media/t/{id}
// (cookie session, Story 2.2);
// thumbnail belum dibuat → null (file tetap di sampel). Tidak ada kolom
// duration di DB → selalu null; extension hanya untuk dokumen ("PDF", …).
function toRepFile(file: {
  id: string;
  mimeType: string;
  thumbnailPath: string | null;
  originalName: string;
}) {
  const kind = kindFromMime(file.mimeType);
  const ext = kind === 'document' ? (file.originalName.split('.').pop() || '').toUpperCase() : '';
  return {
    id: file.id,
    kind,
    thumbnailUrl: file.thumbnailPath ? mediaUrl.thumbnail(file.id) : null,
    duration: null as number | null,
    extension: ext || null,
  };
}

// Story 4.7: `includeTrashed` hanya untuk Section yang SUDAH di Trash
// (`Folder.trashedAt` terisi) — baris Trash tetap punya kandidat walau
// file di dalamnya ikut ter-`trashedAt`. Untuk Section aktif (dipakai
// Shared & dashboard) kandidatnya tetap file `trashedAt: null` saja.
async function repFilesFor(
  where: { projectId: string } | { folderId: { in: string[] } },
  limit: number,
  max: number,
  seedKey: string,
  includeTrashed = false,
) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`limit harus bilangan bulat minimal 1 (maksimal ${max}).`);
  }
  if (limit > max) {
    throw new Error(`limit sampel maksimal ${max} (diminta ${limit}).`);
  }
  const files = await prisma.mediaFile.findMany({
    where: includeTrashed ? where : { ...where, trashedAt: null },
    select: { id: true, mimeType: true, thumbnailPath: true, originalName: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const k = Math.min(limit, files.length);
  const seed = createHash('sha256').update(`${jakartaDatestamp()}:${seedKey}`).digest('hex');
  return pickDeterministic(files, k, seed).map(toRepFile);
}

// SATU jalur per tingkat — dipakai `Project.repFiles`, `Folder.repFiles`,
// dan (Story 4.7) `ShareLink.repThumbs` yang hanya mendelegasikan ke sini.
function projectRepFiles(project: { id: string }, limit: number) {
  return repFilesFor({ projectId: project.id }, limit, REPFILE_MAX.project, project.id);
}

async function folderRepFiles(folder: { id: string; trashedAt?: Date | null }, limit: number) {
  const ids = await collectFolderSubtreeIds(folder.id);
  // Story 4.7: Section di Trash (`allTrashedFolders`) tetap memperoleh
  // kandidat meski file-nya ikut ter-`trashedAt`; Section aktif tidak.
  const includeTrashed = Boolean(folder.trashedAt);
  return repFilesFor({ folderId: { in: ids } }, limit, REPFILE_MAX.folder, folder.id, includeTrashed);
}

// ============================================
// Share link: turunan targetType / targetName / url — SATU sumber untuk
// `shareLinks` (halaman Shared) dan `shareLinksForTarget` (Story 4.4).
// ============================================
const SHARE_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';

function decorateShareLink<
  T extends {
    slug: string;
    fileId: string | null;
    folderId: string | null;
    projectId2: string | null;
    file: { originalName: string } | null;
    folder: { name: string } | null;
    projectRef: { title: string } | null;
  },
>(link: T) {
  // Derive a friendly target type + name based on which relation is set.
  let targetType = 'unknown';
  let targetName = 'Tidak ditemukan';
  if (link.file) { targetType = 'file'; targetName = link.file.originalName; }
  else if (link.folder) { targetType = 'folder'; targetName = link.folder.name; }
  else if (link.projectRef) { targetType = 'project'; targetName = link.projectRef.title; }
  else if (link.fileId) { targetType = 'file'; targetName = 'File sudah dihapus'; }
  else if (link.folderId) { targetType = 'folder'; targetName = 'Folder sudah dihapus'; }
  else if (link.projectId2) { targetType = 'project'; targetName = 'Project sudah dihapus'; }
  return {
    ...link,
    project: link.projectRef,
    targetType,
    targetName,
    url: `${SHARE_BASE_URL}/s/${link.slug}`,
  };
}

const rawResolvers = {
  Query: {
    pendingUsers: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'users.manage');
      return prisma.user.findMany({
        where: { accountStatus: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    },
    passwordResetAvailable: () => PasswordReset.isPasswordResetAvailable(),

    me: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.actor) return null;
      const user = await prisma.user.findUnique({ where: { id: context.actor.id } });
      if (!user || !user.active) return null;
      return user;
    },

    users: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'users.manage');
      return AuthService.getUsers();
    },

    projects: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      const projects = await prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        include: { files: true, folders: true, chats: { include: { sender: true }, orderBy: { createdAt: 'asc' } } },
      });
      // Keep only covers the browser can load: absolute http(s) or our /media/ path.
      return projects.map((p) => ({
        ...p,
        coverImage: isRenderableImageUrl(p.coverImage) ? p.coverImage : null,
      }));
    },

    project: async (_: any, { id }: { id: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      return prisma.project.findUnique({
        where: { id },
        include: {
          folders: { where: { parentId: null, trashedAt: null } },
          chats: { include: { sender: true, referencedFile: true }, orderBy: { createdAt: 'asc' } },
        },
      });
    },

    folder: async (_: any, { id }: { id: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      return prisma.folder.findUnique({
        where: { id },
        include: {
          files: { where: { trashedAt: null } },
          children: { where: { trashedAt: null } },
          project: true,
        },
      });
    },

    searchFolders: async (_: any, { query, projectId }: { query: string; projectId?: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      return prisma.folder.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' },
          ...(projectId ? { projectId } : {}),
          trashedAt: null,
        },
        include: { project: true },
        take: 10,
      });
    },

    searchFiles: async (_: any, { query, projectId }: { query: string; projectId?: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      // Try ES first, fall back to DB if ES fails or returns empty
      let hits: any[] = [];
      try {
        const result = await esClient.search({
          index: 'media_files',
          query: {
            bool: {
              must: [{ multi_match: { query, fields: ['originalName^3', 'category'], fuzziness: 'AUTO' } }],
              ...(projectId ? { filter: [{ term: { projectId } }] } : {})
            }
          }
        });
        hits = result.hits.hits;
      } catch (err) {
        console.warn('[searchFiles] ES error, using DB:', (err as Error).message);
      }
      if (hits.length === 0) {
        // Fallback to DB (ES index may be empty or out of sync)
        const where: any = {
          OR: [{ originalName: { contains: query, mode: 'insensitive' } }, { mimeType: { contains: query, mode: 'insensitive' } }],
          ...(projectId ? { projectId } : {}),
          trashedAt: null,
        };
        return prisma.mediaFile.findMany({ where, take: 20, include: { folder: true, project: true } });
      }
      const results = (await Promise.all(hits.map(async (hit: any) => {
        return prisma.mediaFile.findUnique({
          where: { id: hit._id },
          include: { folder: true, project: true },
        });
      }))).filter(Boolean);
      return results;
    },

    shareLinks: async (_: any, __: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'share.manage');

      // Admin sees all live links, other roles only their own (same rule as revoke).
      const where = isAdminRole(actor.role)
        ? { revokedAt: null }
        : { createdById: actor.id, revokedAt: null };

      const links = await prisma.shareLink.findMany({
        where,
        include: { file: true, folder: true, projectRef: true },
        orderBy: { createdAt: 'desc' },
      });

      return links.map(decorateShareLink);
    },

    // Story 4.4 (aditif): link untuk TEPAT SATU target — dipakai bagian
    // "Link aktif" share-modal (Story 4.6). Hak lihat SAMA dengan halaman
    // Shared: isAdminLike → semua link tim untuk target itu, role lain hanya
    // link dengan createdById miliknya; daftar kosong = [] (bukan error yang
    // membocorkan bahwa link orang lain ada). Turunan targetType/targetName/
    // url memakai decorateShareLink yang sama dengan `shareLinks`.
    shareLinksForTarget: async (
      _: any,
      { fileId, folderId, projectId }: { fileId?: string | null; folderId?: string | null; projectId?: string | null },
      context: GraphQLContext,
    ) => {
      const actor = actorOf(context);
      assertCan(actor, 'share.manage');

      const targets = [
        fileId ? { fileId } : null,
        folderId ? { folderId } : null,
        projectId ? { projectId2: projectId } : null,
      ].filter(Boolean) as ({ fileId: string } | { folderId: string } | { projectId2: string })[];
      if (targets.length !== 1) {
        throw new Error('Tentukan tepat satu target: fileId, folderId, atau projectId.');
      }

      const links = await prisma.shareLink.findMany({
        where: {
          ...targets[0],
          revokedAt: null,
          ...(isAdminRole(actor.role) ? {} : { createdById: actor.id }),
        },
        // createdBy ikut dimuat di sini supaya baris "dibuat {nama}" tidak
        // menembakkan satu query per link (database dev berkolam satu koneksi).
        include: { file: true, folder: true, projectRef: true, createdBy: true },
        orderBy: { createdAt: 'desc' },
      });

      return links.map(decorateShareLink);
    },

    storageStats: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'instance.configure');
      const totalFiles = await prisma.mediaFile.count();
      const totalProjects = await prisma.project.count();
      const sizeResult = await prisma.mediaFile.aggregate({ _sum: { size: true } });
      const usedSpace = Number(sizeResult._sum.size || 0);

      // Get real NAS disk stats via statfs (Node.js 18+)
      let totalSpace = 0;
      let freeSpace = 0;
      try {
        const fs = await import('fs/promises');
        const { execSync } = await import('child_process');
        const nasPath = process.env.STORAGE_LOCAL_ROOT || './data/media';
        // Use --output for machine-parseable columns (avoids path-with-spaces issue)
        const dfOut = execSync(`df -B1 --output=size,avail "${nasPath}" | tail -1`, { encoding: 'utf8', timeout: 3000 });
        const parts = dfOut.trim().split(/\s+/);
        if (parts.length >= 2) {
          totalSpace = parseInt(parts[0], 10) || 0;
          freeSpace = parseInt(parts[1], 10) || 0;
        }
      } catch {
        totalSpace = 0;
        freeSpace = 0;
      }

      return { totalSpace, usedSpace, freeSpace, totalFiles, totalProjects };
    },

    notifications: async (_: any, { unreadOnly }: any, context: GraphQLContext) => {
      if (!context.userId) throw new Error('Unauthorized');
      return NotifService.getNotifications(context.userId, unreadOnly);
    },

    unreadNotificationCount: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.userId) throw new Error('Unauthorized');
      return NotifService.unreadCount(context.userId);
    },

    allTrashedFiles: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.view');
      return prisma.mediaFile.findMany({
        where: { trashedAt: { not: null } },
        include: { folder: { include: { project: true } } },
        orderBy: { trashedAt: 'desc' },
      });
    },

    allTrashedFolders: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.view');
      return prisma.folder.findMany({
        where: { trashedAt: { not: null } },
        include: { project: true },
        orderBy: { trashedAt: 'desc' },
      });
    },
  },

  Mutation: {
    login: async (_: any, { email, password }: { email: string; password: string }, context: GraphQLContext) => {
      await assertLoginRate(context, email);
      try {
        const user = await AuthService.loginUser(email, password);
        // IP and user agent come from the request, never from the client.
        const session = await AuthService.createSession(user.id, {
          ip: context.ip,
          userAgent: context.req?.headers?.get('user-agent') ?? undefined,
        });
        return {
          success: true,
          token: session.token,
          user,
        };
      } catch (error: any) {
        return {
          success: false,
          message: error.message,
        };
      }
    },

    // ---- Reset password mandiri (publik) ----
    requestPasswordReset: (_: unknown, { email }: { email: string }, context: GraphQLContext) => {
      try {
        // Tidak menunggu pengiriman email → isi & waktu respons sama untuk email apa pun.
        PasswordReset.requestReset(email, { ip: context.ip });
        return { success: true, message: PasswordReset.PASSWORD_RESET_MESSAGES.requested, resetToken: null, errorCode: null };
      } catch (error) {
        return passwordResetFailure('requestPasswordReset', error);
      }
    },

    verifyPasswordResetCode: async (_: unknown, { email, code }: { email: string; code: string }) => {
      try {
        const { resetToken } = await PasswordReset.verifyCode(email, code);
        return { success: true, message: PasswordReset.PASSWORD_RESET_MESSAGES.verified, resetToken, errorCode: null };
      } catch (error) {
        return passwordResetFailure('verifyPasswordResetCode', error);
      }
    },

    completePasswordReset: async (
      _: unknown,
      { resetToken, newPassword, confirmPassword }: { resetToken: string; newPassword: string; confirmPassword: string },
    ) => {
      try {
        await PasswordReset.completeReset(resetToken, newPassword, confirmPassword);
        return { success: true, message: PasswordReset.PASSWORD_RESET_MESSAGES.completed, resetToken: null, errorCode: null };
      } catch (error) {
        return passwordResetFailure('completePasswordReset', error);
      }
    },

    logout: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.sessionToken) return false;
      return AuthService.destroySession(context.sessionToken);
    },

    register: async (_: any, { input }: any, context: GraphQLContext) => {
      if (!context.actor) await assertLoginRate(context);
      const requestedRole = (input.role || null) as MamRole | null;
      const answers = parseSignupAnswers(input.signupAnswers);
      const adminCreate = !!context.actor;
      // Signup publik: role yang diminta hanya boleh dari PUBLIC_SIGNUP_ROLES (kalau diisi).
      if (!adminCreate && requestedRole && !PUBLIC_SIGNUP_ROLES.includes(requestedRole)) {
        return { success: false, message: 'Role yang diminta tidak valid untuk pendaftaran publik' };
      }

      // Signed in: an admin creating a team account (users.manage).
      if (adminCreate) {
        if (!requestedRole || !canManageUser(context.actor, null, { kind: 'create', role: requestedRole }, 0)) {
          throw forbidden('Forbidden: users.manage');
        }
        if (!TEAM_CREATE_ROLES.includes(requestedRole)) {
          return { success: false, message: 'Super Admin hanya boleh membuat Admin, Editor, Field Crew, atau Viewer dari panel ini' };
        }
      }

      // Public sign-up (mobile app) or admin-created — both allowed
      try {
        const user = await AuthService.registerUser({
          name: input.name,
          email: input.email,
          password: input.password,
          role: requestedRole || undefined,
          signupAnswers: answers,
          approved: adminCreate, // admin-created -> langsung aktif; publik -> PENDING
        });
        // For public sign-up, auto-create session
        if (!adminCreate) {
          const session = await AuthService.createSession(user.id);
          return { success: true, user, token: session.token };
        }
        return { success: true, user };
      } catch (error: any) {
        return { success: false, message: error.message };
      }
    },

    createProject: async (_: any, { input }: any, context: GraphQLContext) => {
      assertCan(context.actor, 'section.create');
      const cover = isRenderableImageUrl(input.coverImage) ? input.coverImage : undefined;
      return ProjectService.createProject(input.title, input.description, cover);
    },

    createFolder: async (_: any, { projectId, name, parentId }: any, context: GraphQLContext) => {
      assertCan(context.actor, 'section.create');
      return FolderService.createFolder(projectId, name, parentId);
    },

    renameFolder: async (_: any, { folderId, name }: { folderId: string; name: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.move');
      const folder = await prisma.folder.findUnique({ where: { id: folderId } });
      if (!folder) throw new Error('Folder not found');
      return prisma.folder.update({
        where: { id: folderId },
        data: { name },
        include: { children: true, files: true },
      });
    },

    initiateUpload: async (_: any, { input }: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'upload');

      // Validate file type — check inherited folder rules from root default folders
      if (input.folderId) {
        const ext = input.filename.split('.').pop()?.toLowerCase() || '';
        const rootType = await getRootFolderType(input.folderId);
        if (rootType) {
          const invalid = validateFileTypeForFolder(rootType, ext);
          if (invalid) throw new Error(invalid);
        }
      }

      const countryCode = context.req.headers.get('cf-ipcountry') || undefined;
      const result = await UploadService.initiateUpload({
        uploadedById: actor.id,
        projectId: input.projectId,
        filename: input.filename,
        totalSize: BigInt(input.totalSize),
        md5Checksum: input.md5Checksum,
        folderId: input.folderId,
        clientLatencyMs: input.clientLatencyMs,
        clientChunkSize: input.clientChunkSize,
        countryCode,
      });
      console.log(`[initiateUpload] file=${input.filename} country=${countryCode || '-'} latency=${input.clientLatencyMs || '-'}ms mode=${result.uploadMode}`);

      return {
        id: result.session.id,
        chunkSize: result.session.chunkSize,
        totalChunks: result.session.totalChunks,
        uploadMode: result.uploadMode,
        presignedUrl: result.presignedUrl,
        r2Key: result.r2Key,
      };
    },

    completeUpload: async (_: any, { sessionId, r2Key, convertHeic }: any, context: GraphQLContext) => {
      await assertUploadOwner(context, sessionId);
      return UploadService.completeUpload(sessionId, r2Key, convertHeic);
    },

    createShareLink: async (_: any, { input }: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'share.manage');
      return ShareService.createShareLink({
        createdById: actor.id,
        mode: input.mode,
        fileId: input.fileId,
        folderId: input.folderId,
        projectId: input.projectId,
        expiresInHours: input.expiresInHours,
      });
    },

    revokeShareLink: async (_: any, { id }: { id: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      // Same rule as the Shared page: admins revoke any link, others only their own.
      // "Not found" and "not yours" answer the same sentence.
      assertCan(actor, 'share.manage');
      const link = await ShareService.getShareLinkOwner(id);
      if (!link || link.revokedAt || !can(actor, 'share.manage', { ownerId: link.createdById })) {
        throw forbidden('Link tidak ditemukan atau bukan milikmu.');
      }
      return ShareService.revokeShareLink(id);
    },

    markNotificationsRead: async (_: any, __: any, context: GraphQLContext) => {
      assertCanWriteSelf(context.actor);
      return NotifService.markAllRead(context.actor.id);
    },

    completeOnboarding: async (_: any, { requestedRole, signupAnswers }: any, context: GraphQLContext) => {
      assertCanWriteSelf(context.actor);
      const role = requestedRole as MamRole;
      if (!PUBLIC_SIGNUP_ROLES.includes(role)) throw new Error('Role tidak valid');
      const answers = parseSignupAnswers(signupAnswers);
      const user = await prisma.user.update({
        where: { id: context.actor.id },
        data: {
          requestedRole: role,
          signupAnswers: answers === undefined ? undefined : answers,
          onboardedAt: new Date(),
          accountStatus: 'PENDING',
        },
      });
      return user;
    },

    approveUser: async (_: any, { userId, role }: any, context: GraphQLContext) => {
      await assertManageUser(context, userId, { kind: 'approve', role });
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          role: role as MamRole,
          accountStatus: 'ACTIVE',
          active: true,
          approvedById: actorOf(context).id,
          approvedAt: new Date(),
        },
      });
      return user;
    },

    rejectUser: async (_: any, { userId }: any, context: GraphQLContext) => {
      await assertManageUser(context, userId, { kind: 'reject' });
      const user = await prisma.user.update({
        where: { id: userId },
        data: { accountStatus: 'REJECTED', active: false },
      });
      return user;
    },

    googleAuth: async (_: any, { idToken }: any, context: GraphQLContext) => {
      await assertLoginRate(context);
      return GoogleAuth.googleAuth(idToken);
    },

    sendMessage: async (_: any, { projectId, message, referencedFileId }: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'discussion.use');
      // Auto-use or create "Community" project for global chat
      let pid = projectId;
      if (!pid) {
        const existing = await prisma.project.findFirst({ where: { title: 'Community' } });
        if (existing) {
          pid = existing.id;
        } else {
          const created = await prisma.project.create({ data: { title: 'Community', description: 'Global community chat' } });
          pid = created.id;
        }
      }
      const chat = await ChatService.sendMessage(actor.id, pid, message, referencedFileId);
      return chat;
    },

    updateProfile: async (_: any, { name, avatarUrl }: { name?: string; avatarUrl?: string }, context: GraphQLContext) => {
      assertCanWriteSelf(context.actor);
      const data: any = {};
      if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed.length === 0) throw new Error('Name cannot be empty');
        if (trimmed.length > 80) throw new Error('Name too long');
        data.name = trimmed;
      }
      if (typeof avatarUrl === 'string') {
        if (avatarUrl.length > 0 && !isRenderableImageUrl(avatarUrl)) throw new Error('Invalid avatar URL');
        data.avatarUrl = avatarUrl.length > 0 ? avatarUrl : null;
      }
      if (Object.keys(data).length === 0) throw new Error('Nothing to update');
      return prisma.user.update({ where: { id: context.actor.id }, data });
    },

    updateUserRole: async (_: any, { userId, role }: { userId: string; role: string }, context: GraphQLContext) => {
      await assertManageUser(context, userId, { kind: 'role', role });
      return AuthService.updateUserRole(userId, role as AuthService.Role);
    },

    deactivateUser: async (_: any, { id }: { id: string }, context: GraphQLContext) => {
      await assertManageUser(context, id, { kind: 'deactivate' });
      return AuthService.deactivateUser(id);
    },

    reactivateUser: async (_: any, { id }: { id: string }, context: GraphQLContext) => {
      await assertManageUser(context, id, { kind: 'reactivate' });
      return AuthService.reactivateUser(id);
    },

    adminSetPassword: async (
      _: unknown,
      { userId, newPassword }: { userId: string; newPassword?: string | null },
      context: GraphQLContext,
    ) => {
      const actor = actorOf(context);
      assertCan(actor, 'users.manage');
      const currentUser = { id: actor.id, email: (await prisma.user.findUnique({ where: { id: actor.id }, select: { email: true } }))?.email ?? '' };
      const targetError = adminTargetError(actor.id, userId);
      if (targetError) return { success: false, message: targetError, password: null };
      await assertManageUser(context, userId, { kind: 'password' });
      try {
        const result = await AuthService.adminSetPassword(userId, newPassword);
        auditAdminAction('adminSetPassword', currentUser, result.email);
        return {
          success: true,
          message: `Password ${result.email} berhasil diatur. Semua sesi login user ini sudah di-logout.`,
          password: result.generatedPassword,
        };
      } catch (error) {
        return adminActionFailure('adminSetPassword', error);
      }
    },

    deleteUser: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'users.manage');
      const currentUser = { id: actor.id, email: (await prisma.user.findUnique({ where: { id: actor.id }, select: { email: true } }))?.email ?? '' };
      const targetError = adminTargetError(actor.id, id);
      if (targetError) return { success: false, message: targetError, password: null };
      await assertManageUser(context, id, { kind: 'delete' });
      try {
        const result = await AuthService.deleteUserAccount(id);
        auditAdminAction('deleteUser', currentUser, result.email);
        return { success: true, message: `Akun ${result.email} berhasil dihapus.`, password: null };
      } catch (error) {
        return adminActionFailure('deleteUser', error);
      }
    },

    updateProject: async (_: any, { id, input }: any, context: GraphQLContext) => {
      assertCan(context.actor, 'item.move');
      return prisma.project.update({
        where: { id },
        data: { title: input.title, description: input.description },
      });
    },

    deleteProject: async (_: any, { id }: { id: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.purge');
      // Revoke and delete in one transaction: a link created in between makes
      // the delete fail on the one-target CHECK instead of slipping through.
      await prisma.$transaction(async (tx) => {
        const folders = await tx.folder.findMany({ where: { projectId: id }, select: { id: true } });
        const files = await tx.mediaFile.findMany({ where: { projectId: id }, select: { id: true } });
        await ShareService.revokeLinksForTargets(
          { projectIds: [id], folderIds: folders.map((f) => f.id), fileIds: files.map((f) => f.id) },
          'target_deleted',
          tx,
        );
        await tx.project.delete({ where: { id } });
      });
      return true;
    },

    moveToTrash: async (_: any, { fileId }: { fileId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      await prisma.mediaFile.update({ where: { id: fileId }, data: { trashedAt: new Date() } });
      return true;
    },

    restoreFile: async (_: any, { fileId }: { fileId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      return prisma.mediaFile.update({
        where: { id: fileId },
        data: { trashedAt: null },
        include: { folder: true, project: true },
      });
    },

    permanentDelete: async (_: any, { fileId }: { fileId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.purge');
      const file = await prisma.mediaFile.findUnique({ where: { id: fileId } });
      if (file) {
        await prisma.$transaction(async (tx) => {
          await ShareService.revokeLinksForTargets({ fileIds: [fileId] }, 'target_deleted', tx);
          await tx.mediaFile.delete({ where: { id: fileId } });
        });
        const fs = await import('fs/promises');
        fs.unlink(file.storagePath).catch(() => { });
      }
      return true;
    },

    moveFolderToTrash: async (_: any, { folderId }: { folderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      await prisma.folder.update({ where: { id: folderId }, data: { trashedAt: new Date() } });
      return true;
    },

    restoreFolder: async (_: any, { folderId }: { folderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      return prisma.folder.update({
        where: { id: folderId },
        data: { trashedAt: null },
        include: { children: true, files: true },
      });
    },

    permanentDeleteFolder: async (_: any, { folderId }: { folderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.purge');

      const subtree = await allSubtreeFolderIds(folderId);
      const files = await prisma.mediaFile.findMany({
        where: { folderId: { in: subtree } },
        select: { id: true, storagePath: true },
      });
      // Resolved before the rows go (the path is derived from them).
      const folderPath = await FolderService.getFolderPhysicalPath(folderId).catch(() => null);

      // Revoke links and delete rows in one transaction (see deleteProject).
      await prisma.$transaction(async (tx) => {
        await ShareService.revokeLinksForTargets(
          { folderIds: subtree, fileIds: files.map((f) => f.id) },
          'target_deleted',
          tx,
        );
        await tx.mediaFile.deleteMany({ where: { folderId: { in: subtree } } });
        await tx.folder.deleteMany({ where: { id: { in: subtree } } });
      });

      // Bytes go after the rows are committed.
      const fs = await import('fs/promises');
      for (const f of files) fs.unlink(f.storagePath).catch(() => {});
      if (folderPath) await fs.rm(folderPath, { recursive: true, force: true }).catch(() => {});

      return true;
    },

    cancelUpload: async (_: any, { sessionId }: { sessionId: string }, context: GraphQLContext) => {
      await assertUploadOwner(context, sessionId);
      await prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: 'FAILED' },
      });
      return true;
    },

    moveFile: async (_: any, { fileId, targetFolderId }: { fileId: string; targetFolderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.move');
      const file = await prisma.mediaFile.findUnique({ where: { id: fileId } });
      if (!file) throw new Error('File not found');
      const targetFolder = await prisma.folder.findUnique({ where: { id: targetFolderId } });
      if (!targetFolder) throw new Error('Target folder not found');

      // Move file on NAS — use proper folder physical path
      const path = await import('path');
      const fs = await import('fs/promises');
      const targetDir = await FolderService.getFolderPhysicalPath(targetFolderId);
      await fs.mkdir(targetDir, { recursive: true });
      const newPath = path.join(targetDir, path.basename(file.storagePath));
      fs.rename(file.storagePath, newPath).catch(() => { });

      return prisma.mediaFile.update({
        where: { id: fileId },
        data: { folderId: targetFolderId, projectId: targetFolder.projectId, storagePath: newPath },
        include: { folder: true, project: true, uploadedBy: true },
      });
    },

    copyFile: async (_: any, { fileId, targetFolderId }: { fileId: string; targetFolderId: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'upload');
      const file = await prisma.mediaFile.findUnique({ where: { id: fileId } });
      if (!file) throw new Error('File not found');
      const targetFolder = await prisma.folder.findUnique({ where: { id: targetFolderId } });
      if (!targetFolder) throw new Error('Target folder not found');

      const path = await import('path');
      const fs = await import('fs/promises');
      const targetDir = await FolderService.getFolderPhysicalPath(targetFolderId);
      await fs.mkdir(targetDir, { recursive: true });
      const newId = randomUUID();
      const ext = path.extname(file.originalName);
      const newName = `${newId}${ext}`;
      const newPath = path.join(targetDir, newName);
      try { await fs.copyFile(file.storagePath, newPath); } catch { /* skip if NAS copy fails */ }

      return prisma.mediaFile.create({
        data: {
          id: newId,
          filename: newName,
          originalName: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          md5Checksum: file.md5Checksum,
          storagePath: newPath,
          folderId: targetFolderId,
          projectId: targetFolder.projectId,
          uploadedById: actor.id,
        },
        include: { folder: true, project: true, uploadedBy: true },
      });
    },

    moveFolder: async (
      _: any,
      { folderId, targetFolderId, targetProjectId }: { folderId: string; targetFolderId?: string | null; targetProjectId?: string | null },
      context: GraphQLContext,
    ) => {
      assertCan(context.actor, 'item.move');
      const folder = await prisma.folder.findUnique({ where: { id: folderId } });
      if (!folder) throw new Error('Folder not found');

      if (!targetFolderId && !targetProjectId) {
        throw new Error('Provide either targetFolderId or targetProjectId');
      }
      if (targetFolderId && targetFolderId === folderId) {
        throw new Error('Cannot move folder into itself');
      }

      // Resolve destination: either inside a folder or at a project root
      let destProjectId: string;
      if (targetFolderId) {
        const targetFolder = await prisma.folder.findUnique({ where: { id: targetFolderId } });
        if (!targetFolder) throw new Error('Target folder not found');
        destProjectId = targetFolder.projectId;

        // Prevent cycle: target must not be a descendant of the folder being moved
        let cursor: { id: string; parentId: string | null } | null = targetFolder;
        while (cursor?.parentId) {
          if (cursor.parentId === folderId) {
            throw new Error('Cannot move folder into its own descendant');
          }
          cursor = await prisma.folder.findUnique({
            where: { id: cursor.parentId },
            select: { id: true, parentId: true },
          });
        }
      } else {
        const targetProject = await prisma.project.findUnique({ where: { id: targetProjectId! } });
        if (!targetProject) throw new Error('Target project not found');
        destProjectId = targetProject.id;
      }

      const crossProject = destProjectId !== folder.projectId;

      // Collect all folder IDs in the moved subtree (including self) — needed for
      // projectId cascade and file storagePath rewrite.
      const subtreeFolderIds: string[] = [folderId];
      let frontier: string[] = [folderId];
      while (frontier.length) {
        const children = await prisma.folder.findMany({
          where: { parentId: { in: frontier } },
          select: { id: true },
        });
        const ids = children.map(c => c.id);
        if (!ids.length) break;
        subtreeFolderIds.push(...ids);
        frontier = ids;
      }

      // Capture old physical path BEFORE DB changes
      const oldPath = await FolderService.getFolderPhysicalPath(folderId);

      // 1) Re-parent the folder (parentId may be null when dropping at project root)
      await prisma.folder.update({
        where: { id: folderId },
        data: {
          parentId: targetFolderId ?? null,
          projectId: destProjectId,
        },
      });

      // 2) Cascade projectId to descendants if crossing projects
      if (crossProject) {
        await prisma.$transaction([
          prisma.folder.updateMany({
            where: { id: { in: subtreeFolderIds } },
            data: { projectId: destProjectId },
          }),
          prisma.mediaFile.updateMany({
            where: { folderId: { in: subtreeFolderIds } },
            data: { projectId: destProjectId },
          }),
        ]);
      }

      // 3) Move physical directory on NAS
      const newPath = await FolderService.getFolderPhysicalPath(folderId);
      const fs = await import('fs/promises');
      const pathLib = await import('path');
      try {
        await fs.mkdir(pathLib.dirname(newPath), { recursive: true });
        await fs.rename(oldPath, newPath);
      } catch (err) {
        console.warn(`[moveFolder] NAS rename failed ${oldPath} → ${newPath}:`, (err as Error).message);
      }

      // 4) Rewrite storagePath for every file in the moved subtree
      const files = await prisma.mediaFile.findMany({
        where: { folderId: { in: subtreeFolderIds } },
        select: { id: true, storagePath: true },
      });
      for (const f of files) {
        if (f.storagePath?.startsWith(oldPath)) {
          await prisma.mediaFile.update({
            where: { id: f.id },
            data: { storagePath: newPath + f.storagePath.slice(oldPath.length) },
          });
        }
      }

      return prisma.folder.findUnique({
        where: { id: folderId },
        include: { children: true, files: true },
      });
    },

  },

  User: {
    accountStatus: (parent: any) => parent.accountStatus || 'ACTIVE',
    // Story 2.4: the UI reads this list and never re-implements role rules.
    permissions: (parent: any) =>
      permissionsFor({
        id: parent.id,
        role: parent.role,
        active: parent.active,
        accountStatus: parent.accountStatus,
        readOnly: parent.readOnly,
      }),
    signupAnswers: (parent: any) => parent.signupAnswers ? JSON.stringify(parent.signupAnswers) : null,
    hasPassword: (parent: { passwordHash?: string | null }) => !!parent.passwordHash,
    readOnly: (parent: { readOnly?: boolean | null }) => !!parent.readOnly,
  },

  Project: {
    files: async (parent: any) => {
      return prisma.mediaFile.findMany({
        where: { projectId: parent.id, trashedAt: null },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    },
    totalFiles: async (parent: any) => {
      // Story 2.4: file di Trash tidak dihitung (paritas Project.files yang
      // menyaring trashedAt: null) — angka beberapa project turun; itu
      // memang perbaikannya (keputusan user 21 Sep 2026).
      return prisma.mediaFile.count({ where: { projectId: parent.id, trashedAt: null } });
    },
    totalSize: async (parent: any) => {
      const result = await prisma.mediaFile.aggregate({
        where: { projectId: parent.id, trashedAt: null },
        _sum: { size: true },
      });
      return Number(result._sum.size || 0);
    },
    // Story 2.4: SATU groupBy atas seluruh file project lintas Section
    // (setiap mediaFile membawa projectId); server hanya angka mentah.
    contentSummary: async (parent: any) => {
      const rows = await prisma.mediaFile.groupBy({
        by: ['mimeType'],
        where: { projectId: parent.id, trashedAt: null },
        _count: { _all: true },
      });
      return summarizeCounts(rows);
    },
    repFiles: async (parent: any, { limit }: { limit: number }) => {
      return projectRepFiles(parent, limit);
    },
  },

  Folder: {
    totalFiles: async (parent: any) => {
      return countFilesRecursive(parent.id);
    },
    // Story 2.4: rekap subtree — kumpulkan id Section dulu (pola
    // countFilesRecursive), lalu SATU groupBy untuk seluruh subtree.
    contentSummary: async (parent: any) => {
      const ids = await collectFolderSubtreeIds(parent.id);
      const rows = await prisma.mediaFile.groupBy({
        by: ['mimeType'],
        where: { folderId: { in: ids }, trashedAt: null },
        _count: { _all: true },
      });
      return summarizeCounts(rows);
    },
    repFiles: async (parent: any, { limit }: { limit: number }) => {
      return folderRepFiles(parent, limit);
    },
    folderType: async (parent: any) => {
      return getRootFolderType(parent.id);
    },
    // Story 2.15 (aditif, tanpa perubahan typeDefs): `Folder.children`
    // sudah ada di skema tetapi hanya terisi lewat `include` di query
    // `folder(id)`. Baris kedua sub-Section di mode daftar juga memintanya
    // dari `project.folders`, yang tidak memuat relasi itu — tanpa resolver
    // ini field non-null-nya mengembalikan null dan SELURUH query gagal.
    children: async (parent: any) => {
      if (Array.isArray(parent.children)) return parent.children;
      return prisma.folder.findMany({
        where: { parentId: parent.id, trashedAt: null },
        orderBy: { name: 'asc' },
      });
    },
  },

  // Story 2.15 (aditif, tanpa perubahan typeDefs): kolom "Diunggah oleh"
  // di mode daftar meminta `MediaFile.uploadedBy` dari query `folder(id)`,
  // yang tidak meng-`include` relasi itu. Tanpa resolver ini field
  // non-null-nya mengembalikan null dan SELURUH query isi Section gagal.
  MediaFile: {
    // Story 2.2: cookie-authorised media paths, never a token in the URL.
    thumbnailUrl: (parent: any) => (parent.thumbnailPath ? mediaUrl.thumbnail(parent.id) : null),
    downloadUrl: (parent: any) => mediaUrl.download(parent.id),
    uploadedBy: async (parent: any) => {
      if (parent.uploadedBy) return parent.uploadedBy;
      if (!parent.uploadedById) return null;
      return prisma.user.findUnique({ where: { id: parent.uploadedById } });
    },
  },

  // Story 4.4 (aditif): `ShareLink.createdBy` dimuat dari createdById bila
  // belum ter-include — `shareLinks` lama pun bisa menampilkan pembuat tanpa
  // mengubah bentuk query yang sudah dipakai halaman Shared.
  ShareLink: {
    // Story 2.3: only set on the createShareLink result (shown once to the creator).
    accessCode: (parent: any) => parent.accessCode ?? null,
    createdBy: async (parent: any) => {
      if (parent.createdBy) return parent.createdBy;
      return prisma.user.findUnique({ where: { id: parent.createdById } });
    },
    // Story 4.7 (FR40): SATU-SATUNYA field baru. Menjepit `limit` ke 1–3
    // (anggaran `rep-thumb`) lalu MENDELEGASIKAN — Project →
    // `Project.repFiles`, Section → `Folder.repFiles`, file → file itu
    // sendiri — tanpa menulis ulang aturan pemilihan/seed harian Story 2.4.
    // Target yang sudah dihapus → [] (bukan error) supaya baris Shared tetap
    // tampil dan link yatimnya tetap bisa dicabut. Relasi biasanya sudah
    // ter-`include` oleh `shareLinks` / `shareLinksForTarget`; bila parent
    // datang tanpa relasi, dimuat dari kolom id-nya.
    repThumbs: async (parent: any, { limit }: { limit?: number | null }) => {
      const k = Math.min(3, Math.max(1, Number.isInteger(limit) ? (limit as number) : 3));

      if (parent.fileId) {
        const file =
          parent.file !== undefined
            ? parent.file
            : await prisma.mediaFile.findUnique({ where: { id: parent.fileId } });
        return file ? [toRepFile(file)] : [];
      }

      if (parent.folderId) {
        const folder =
          parent.folder !== undefined
            ? parent.folder
            : await prisma.folder.findUnique({ where: { id: parent.folderId } });
        if (!folder) return [];
        return folderRepFiles(folder, k);
      }

      if (parent.projectId2) {
        const project =
          parent.projectRef !== undefined
            ? parent.projectRef
            : await prisma.project.findUnique({ where: { id: parent.projectId2 } });
        if (!project) return [];
        return projectRepFiles(project, k);
      }

      return [];
    },
  },

  // Story 4.1 (aditif, tanpa perubahan typeDefs): `ProjectChat.sender`
  // sudah `User!` di skema, tetapi hanya terisi lewat `include` pada jalur
  // yang kebetulan memuatnya. Resolver ini memakai `parent.sender` bila
  // sudah ter-include dan jatuh ke `findUnique` bila belum, sehingga
  // `sender { id name role avatarUrl }` resolve di keempat jalur —
  // `Query.project`, `Query.projects`, `Mutation.sendMessage`, dan
  // `Subscription.chatMessages` (payload pubsub sudah membawa `sender`).
  // `referencedFile` mendapat perlakuan yang sama: `Query.projects` tidak
  // meng-`include`-nya, jadi Chat Monitor tidak pernah melihat lampiran.
  ProjectChat: {
    sender: async (parent: any) => {
      if (parent.sender) return parent.sender;
      if (!parent.senderId) return null;
      return prisma.user.findUnique({ where: { id: parent.senderId } });
    },
    referencedFile: async (parent: any) => {
      if (parent.referencedFile !== undefined) return parent.referencedFile;
      if (!parent.referencedFileId) return null;
      return prisma.mediaFile.findUnique({ where: { id: parent.referencedFileId } });
    },
  },

  // BigInt scalar — serialize as Number (safe up to 9PB)
  BigInt: {
    serialize(value: unknown): number {
      return Number(value);
    },
    parseValue(value: unknown): bigint {
      return BigInt(value as number);
    },
  },

  Subscription: {
    uploadProgress: {
      // Only the uploader may follow an upload session.
      subscribe: async (_: any, { sessionId }: { sessionId: string }, context: GraphQLContext) => {
        await assertUploadOwner(context, sessionId);
        return pubsub.asyncIterator(`UPLOAD_PROGRESS_${sessionId}`);
      },
    },
    chatMessages: {
      // Story 4.1: langganan divalidasi seperti query/mutasi — `userId`
      // diisi `server.ts` dari `connectionParams.authorization` yang dicek
      // terhadap tabel `Session` (AuthService.validateSession). Tanpa sesi
      // valid tidak satu pun pesan, nama, atau role mengalir lewat WS.
      subscribe: (_: any, { projectId }: { projectId: string }, context: GraphQLContext) => {
        assertCan(context?.actor, 'project.view');
        return pubsub.asyncIterator(`CHAT_MESSAGES_${projectId}`);
      },
    },
    notificationReceived: {
      subscribe: (_: any, __: any, context: GraphQLContext) => {
        const actor = actorOf(context);
        return pubsub.asyncIterator(`NOTIFICATIONS_${actor.id}`);
      },
      resolve: (payload: any) => payload?.newNotification ?? payload?.notificationReceived,
    },
  },
};

// Story 2.1: every root field passes the auth mode declared in auth-map.ts.
export const resolvers = applyAuthMap(rawResolvers);
