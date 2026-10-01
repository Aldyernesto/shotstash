// Shotstash — GraphQL Resolvers
// Layer 2: Core Business logic wrapper

import { createHash } from 'crypto';
import { v7 as uuidv7 } from 'uuid';
import * as AuthService from '../services/auth.service';
import * as ShareService from '../services/share.service';
import * as FolderService from '../services/folder.service';
import * as ChatService from '../services/chat.service';
import * as NotifService from '../services/notification.service';
import * as GoogleAuth from '../services/google-auth.service';
import * as ProjectService from '../services/project.service';
import * as PasswordReset from '../services/password-reset.service';
import prisma from '../lib/prisma';
import { config } from '../lib/config';
import { publicSignupRefusal } from '../lib/signupGuard';
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
import { limitBy, loginLimit } from '../lib/rateLimit';
import { folderChainTrashed } from '../lib/shareLink';
import * as Trash from '@/modules/trash';
import * as Upload from '@/modules/upload';
import * as Library from '@/modules/library';
import * as Pipeline from '@/modules/pipeline';
import { storage, storageKeys } from '@/modules/storage';
import { isSupportedLocale } from '@/modules/i18n';
import { previewOf } from '@/modules/media';
import { LOGIN_INTERNAL_ERROR } from '../lib/authMessages';
import { GraphQLError } from 'graphql';
import { codedError } from '@/modules/errors';
import { errMessage, logger } from '../lib/logger';

const log = logger('graphql');

function rateLimited(retryAfter: number) {
  return new GraphQLError('Too many attempts', { extensions: { code: 'RATE_LIMITED', retryAfter } });
}

/** Longest chat message accepted (Story 2.5). */
const MAX_CHAT_MESSAGE_LENGTH = 5000;

function notFound(message: string) {
  return new GraphQLError(message, { extensions: { code: 'NOT_FOUND' } });
}

/** Story 5.1: job API refusals as coded GraphQL errors. */
function jobError(err: unknown): unknown {
  if (err instanceof Pipeline.JobRequestError) {
    if (err.code === 'KIND_UNKNOWN') return codedError('KIND_UNKNOWN', err.message);
    if (err.code === 'KIND_NOT_APPLICABLE') return codedError('KIND_NOT_APPLICABLE', err.message);
    if (err.code === 'JOB_TERMINAL') return codedError('JOB_TERMINAL', err.message);
    return notFound(err.message);
  }
  return err;
}

// Story 2.5: writes that target a Section, file or project require a live
// (existing, not trashed) target. `folderChainTrashed` stays as a defense in
// depth although the trash cascade marks every descendant.
async function assertLiveFolder(folderId: string, label = 'Section') {
  const folder = await prisma.folder.findUnique({ where: { id: folderId } });
  if (!folder || folder.trashedAt || (await folderChainTrashed(folder.parentId))) throw notFound(`${label} not found`);
  return folder;
}

async function assertLiveFile(fileId: string) {
  const file = await prisma.mediaFile.findUnique({ where: { id: fileId } });
  if (!file || file.status !== 'ready' || file.trashedAt || (await folderChainTrashed(file.folderId))) throw notFound('File not found');
  return file;
}

async function assertProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw notFound('Project not found');
  return project;
}

// Same throttle as REST login (10 per 15 min per IP, plus per email for passwords).
async function assertLoginRate(context: GraphQLContext, email?: string | null) {
  const retryAfter = await loginLimit(context.ip, email);
  if (retryAfter !== null) throw rateLimited(retryAfter);
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
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, role: true, accountStatus: true },
  });
  if (!target) throw codedError('USER_NOT_FOUND', 'User not found');
  if (!canManageUser(actor, target, change, await superAdminCount())) {
    throw forbidden(`Forbidden: users.manage (${change.kind})`);
  }
  return target;
}

async function assertUploadOwner(context: GraphQLContext, sessionId: string) {
  const actor = actorOf(context);
  const session = await prisma.uploadSession.findUnique({ where: { id: sessionId }, select: { uploadedById: true } });
  if (!session) throw codedError('UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
  assertCan(actor, 'upload', { ownerId: session.uploadedById });
}
// Aksi admin berisiko (reset password / hapus akun): target tidak boleh diri sendiri.
// Target SUPER_ADMIN & user tidak ditemukan ditolak di AuthService (AdminActionError).
// Admin payloads carry a stable `errorCode` (plus activity counts for
// USER_HAS_ACTIVITY); `message` is an English developer string.
function adminTargetError(callerId: string, targetId: string) {
  if (!targetId) return { success: false, message: 'User not found', password: null, errorCode: 'USER_NOT_FOUND' };
  if (targetId === callerId) {
    return { success: false, message: 'This action cannot target your own account', password: null, errorCode: 'CANNOT_TARGET_SELF' };
  }
  return null;
}
function adminActionFailure(action: string, error: unknown) {
  if (error instanceof AuthService.AdminActionError) {
    return { success: false, message: error.message, password: null, errorCode: error.code, ...error.details };
  }
  // Never log mutation arguments (they may hold a password): the error message only.
  log.error('admin action failed', { action, err: errMessage(error) });
  return { success: false, message: 'Internal error', password: null, errorCode: 'INTERNAL' };
}
// Audit trail of risky admin actions. Never include a password.
function auditAdminAction(action: string, actor: { id: string; email: string } | null, targetEmail: string) {
  logger('audit').warn('admin action', { action, actorId: actor?.id, actorEmail: actor?.email, target: targetEmail });
}
// Hasil mutasi reset password. Error tak terduga → pesan generik; hanya error.message yang di-log
// (JANGAN log argumen mutasi: berisi kode/token/password).
function passwordResetFailure(action: string, error: unknown) {
  if (error instanceof PasswordReset.PasswordResetError) {
    return {
      success: false,
      message: error.message,
      resetToken: null,
      errorCode: error.code,
      attemptsLeft: error.attemptsLeft,
    };
  }
  log.error('password reset failed', { action, err: errMessage(error) });
  return { success: false, message: 'Internal error', resetToken: null, errorCode: 'INTERNAL', attemptsLeft: null };
}
function parseSignupAnswers(value: unknown) {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return { raw: value }; }
}

type DefaultSectionType = 'video' | 'photo' | 'document';

/**
 * Names of the default Sections a new project gets (Video, Photo, Documents),
 * lowercased, plus the names older installs used for them.
 */
const DEFAULT_SECTION_TYPES: Record<string, DefaultSectionType> = {
  video: 'video',
  photo: 'photo',
  foto: 'photo', // i18n-ignore: legacy default Section name, matched only
  documents: 'document',
  dokumen: 'document', // i18n-ignore: legacy default Section name, matched only
};

function defaultSectionType(name: string): DefaultSectionType | null {
  return DEFAULT_SECTION_TYPES[name.trim().toLowerCase()] ?? null;
}

/** FILE_TYPE_NOT_ALLOWED when a default Section (Video, Photo, Documents) refuses this extension. */
function validateFileTypeForFolder(folderName: string, ext: string): GraphQLError | null {
  const type = defaultSectionType(folderName);
  const refuse = (sectionType: DefaultSectionType, allowed: string[]) =>
    codedError('FILE_TYPE_NOT_ALLOWED', `The ${folderName} Section accepts only ${allowed.join(', ')}; .${ext} refused`, {
      sectionType,
      ext,
    });
  if (type === 'video' && !VIDEO_EXTS.includes(ext)) return refuse('video', VIDEO_EXTS);
  if (type === 'photo' && !PHOTO_EXTS.includes(ext)) return refuse('photo', PHOTO_EXTS);
  if (type === 'document' && !DOC_EXTS.includes(ext)) return refuse('document', DOC_EXTS);
  return null;
}

// Trace folder ancestry to find the root default Section (its own name).
async function getRootFolderType(folderId: string): Promise<string | null> {
  let current = await prisma.folder.findUnique({ where: { id: folderId } });
  while (current) {
    if (defaultSectionType(current.name)) return current.name;
    if (!current.parentId) break;
    current = await prisma.folder.findUnique({ where: { id: current.parentId } });
  }
  return null;
}

async function countFilesRecursive(folderId: string): Promise<number> {
  let count = await prisma.mediaFile.count({ where: { folderId, trashedAt: null, status: 'ready' } });
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
// `trashRoot`: for a Section in the Trash, also the descendants trashed with it.
async function collectFolderSubtreeIds(folderId: string, trashRoot?: string): Promise<string[]> {
  const ids = [folderId];
  const children = await prisma.folder.findMany({
    where: { parentId: folderId, OR: [{ trashedAt: null }, ...(trashRoot ? [{ trashRootId: trashRoot }] : [])] },
    select: { id: true },
  });
  for (const child of children) {
    ids.push(...(await collectFolderSubtreeIds(child.id, trashRoot)));
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
  thumbVersion: number;
  originalName: string;
}) {
  const kind = kindFromMime(file.mimeType);
  const ext = kind === 'document' ? (file.originalName.split('.').pop() || '').toUpperCase() : '';
  return {
    id: file.id,
    kind,
    thumbnailUrl: file.thumbVersion ? mediaUrl.thumbnail(file.id, file.thumbVersion) : null,
    duration: null as number | null,
    extension: ext || null,
  };
}

/**
 * Story 4.5: the files of one Section for the library, in three queries
 * whatever their number (a 10,000-file Section must stay fast): the rows
 * with the columns the schema reads, every processed version of the
 * Section, and the distinct uploaders.
 */
async function sectionFiles(folderId: string) {
  const files = await prisma.mediaFile.findMany({
    where: { folderId, trashedAt: null, status: 'ready' },
    select: {
      id: true,
      filename: true,
      originalName: true,
      mimeType: true,
      size: true,
      md5Checksum: true,
      thumbVersion: true,
      duplicateOfId: true,
      uploadedById: true,
      folderId: true,
      projectId: true,
      trashedAt: true,
      status: true,
      createdAt: true,
    },
  });
  const versions = await prisma.processedVersion.findMany({
    where: { mediaFile: { folderId, trashedAt: null, status: 'ready' } },
    orderBy: { createdAt: 'desc' },
  });
  const uploaderIds = [...new Set(files.map((f) => f.uploadedById))];
  const users = uploaderIds.length ? await prisma.user.findMany({ where: { id: { in: uploaderIds } } }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const versionsOf = new Map<string, typeof versions>();
  for (const v of versions) {
    const list = versionsOf.get(v.mediaFileId) ?? [];
    list.push(v);
    versionsOf.set(v.mediaFileId, list);
  }
  return files.map((f) => ({ ...f, processedVersions: versionsOf.get(f.id) ?? [], uploadedBy: userById.get(f.uploadedById) ?? null }));
}

type VersionRow = Awaited<ReturnType<typeof prisma.processedVersion.findMany>>[number];

/**
 * Per-request loader of processed versions: every file resolved in one
 * GraphQL request (search results, chat mentions, ...) is answered by one
 * query, and a file asked twice (processedVersions and previewUrl) once.
 */
type VersionLoader = { cache: Map<string, Promise<VersionRow[]>>; queue: Map<string, (rows: VersionRow[]) => void> };
const versionLoaders = new WeakMap<object, VersionLoader>();

function loadVersions(context: object | undefined, fileId: string): Promise<VersionRow[]> {
  const key = context ?? {};
  let loader = versionLoaders.get(key);
  if (!loader) {
    loader = { cache: new Map(), queue: new Map() };
    versionLoaders.set(key, loader);
  }
  const l = loader;
  const hit = l.cache.get(fileId);
  if (hit) return hit;
  const p = new Promise<VersionRow[]>((resolve) => {
    if (!l.queue.size) {
      setImmediate(async () => {
        const batch = new Map(l.queue);
        l.queue.clear();
        const rows = await prisma.processedVersion
          .findMany({ where: { mediaFileId: { in: [...batch.keys()] } }, orderBy: { createdAt: 'desc' } })
          .catch(() => [] as VersionRow[]);
        for (const [id, done] of batch) done(rows.filter((r) => r.mediaFileId === id));
      });
    }
    l.queue.set(fileId, resolve);
  });
  l.cache.set(fileId, p);
  return p;
}

/** Processed versions of a file row, newest first (included by `folder(id)`, else loaded per request in one batch). */
async function processedVersionsOf(parent: { id: string; processedVersions?: unknown }, context?: object) {
  if (Array.isArray(parent.processedVersions)) return parent.processedVersions as { id: string; kind: string; mimeType: string }[];
  return loadVersions(context, parent.id);
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
    throw codedError('INVALID_LIMIT', `limit must be an integer from 1 to ${max}`, { max });
  }
  if (limit > max) {
    throw codedError('INVALID_LIMIT', `limit must be at most ${max} (got ${limit})`, { max });
  }
  const files = await prisma.mediaFile.findMany({
    where: includeTrashed ? { ...where, status: 'ready' } : { ...where, trashedAt: null, status: 'ready' },
    select: { id: true, mimeType: true, thumbVersion: true, originalName: true },
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
  const ids = await collectFolderSubtreeIds(folder.id, folder.trashedAt ? folder.id : undefined);
  // Story 4.7: Section di Trash (`allTrashedFolders`) tetap memperoleh
  // kandidat meski file-nya ikut ter-`trashedAt`; Section aktif tidak.
  const includeTrashed = Boolean(folder.trashedAt);
  return repFilesFor({ folderId: { in: ids } }, limit, REPFILE_MAX.folder, folder.id, includeTrashed);
}

// ============================================
// Share link: turunan targetType / targetName / url — SATU sumber untuk
// `shareLinks` (halaman Shared) dan `shareLinksForTarget` (Story 4.4).
// ============================================

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
  // null = the target is gone; the client shows its own "deleted" label.
  let targetName: string | null = null;
  if (link.file) { targetType = 'file'; targetName = link.file.originalName; }
  else if (link.folder) { targetType = 'folder'; targetName = link.folder.name; }
  else if (link.projectRef) { targetType = 'project'; targetName = link.projectRef.title; }
  else if (link.fileId) targetType = 'file';
  else if (link.folderId) targetType = 'folder';
  else if (link.projectId2) targetType = 'project';
  return {
    ...link,
    project: link.projectRef,
    targetType,
    targetName,
    url: `${config().appUrl}/s/${link.slug}`,
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
      // Story 2.5: the list carries no chats (ProjectSummary has no such
      // field) and no trashed Sections; files load through their resolver.
      const projects = await prisma.project.findMany({
        orderBy: { createdAt: 'desc' },
        include: { folders: { where: { trashedAt: null } } },
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
      // A trashed Section (or one inside a trashed Section) answers null.
      const folder = await prisma.folder.findFirst({
        where: { id, trashedAt: null },
        include: { children: { where: { trashedAt: null } }, project: true },
      });
      if (!folder || (await folderChainTrashed(folder.parentId))) return null;
      return { ...folder, files: await sectionFiles(folder.id) };
    },

    processedVersions: async (_: unknown, { fileId }: { fileId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      const file = await assertLiveFile(fileId);
      return prisma.processedVersion.findMany({ where: { mediaFileId: file.id }, orderBy: { createdAt: 'desc' } });
    },

    pipelineJob: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      const job = await Pipeline.jobById(id);
      if (!job) return null;
      try {
        await assertLiveFile(job.fileId);
      } catch {
        return null;
      }
      return job;
    },

    pipelineWorkers: async (_: unknown, __: unknown, context: GraphQLContext) => {
      assertCan(context.actor, 'instance.configure');
      return Pipeline.listWorkers();
    },

    // Story 4.5: one query shape with or without Elasticsearch (library module).
    searchFolders: async (_: any, { query, projectId }: { query: string; projectId?: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      return Library.searchFolders({ query, projectId });
    },

    searchFiles: async (_: any, { query, projectId }: { query: string; projectId?: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'project.view');
      return Library.searchFiles({ query, projectId });
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
        throw codedError('INVALID_SHARE_TARGET', 'Exactly one target is required: fileId, folderId or projectId');
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
      const totalFiles = await prisma.mediaFile.count({ where: { status: 'ready' } });
      const totalProjects = await prisma.project.count();
      const sizeResult = await prisma.mediaFile.aggregate({ where: { status: 'ready' }, _sum: { size: true } });
      const usedSpace = Number(sizeResult._sum.size || 0);
      // Disk size and free space come from the backend when it can tell
      // (local disk); S3 has no capacity, so the fields are null.
      const store = storage();
      const capacity = await store.capacity().catch(() => null);
      return {
        backend: store.name,
        totalSpace: capacity?.total ?? null,
        usedSpace,
        freeSpace: capacity?.free ?? null,
        totalFiles,
        totalProjects,
      };
    },

    uploadSession: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'upload');
      try {
        return await Upload.uploadSessionInfo(actor, id);
      } catch (err) {
        if (err instanceof Upload.UploadFailure && err.code === 'UPLOAD_SESSION_NOT_FOUND') return null;
        throw Upload.asGraphQLError(err);
      }
    },

    checkDuplicates: async (
      _: unknown,
      { projectId, candidates }: { projectId: string; candidates: { name: string; size: bigint | number; md5?: string | null }[] },
      context: GraphQLContext,
    ) => {
      assertCan(context.actor, 'upload');
      await assertProject(projectId);
      const list = (candidates ?? []).map((c) => ({ name: String(c.name), size: Number(c.size), md5: c.md5 ?? null }));
      if (list.some((c) => !Number.isSafeInteger(c.size) || c.size < 0)) {
        throw codedError('BAD_REQUEST', 'Every candidate size must be a whole, non-negative number of bytes');
      }
      return Upload.checkDuplicates(projectId, list);
    },

    notifications: async (_: any, { unreadOnly }: any, context: GraphQLContext) => {
      if (!context.userId) throw codedError('UNAUTHENTICATED', 'Unauthorized');
      return NotifService.getNotifications(context.userId, unreadOnly);
    },

    unreadNotificationCount: async (_: any, __: any, context: GraphQLContext) => {
      if (!context.userId) throw codedError('UNAUTHENTICATED', 'Unauthorized');
      return NotifService.unreadCount(context.userId);
    },

    allTrashedFiles: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.view');
      return Trash.trashedFileRoots();
    },

    allTrashedFolders: async (_: any, __: any, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.view');
      return Trash.trashedFolderRoots();
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
        // Only a LoginError carries a user-facing code; anything else
        // (database down, Prisma P1001, a bug) is INTERNAL.
        if (error instanceof AuthService.LoginError) {
          return { success: false, message: error.message, errorCode: error.code };
        }
        log.error('login: unexpected failure', { err: error });
        return { success: false, message: 'Internal error', errorCode: LOGIN_INTERNAL_ERROR };
      }
    },

    // ---- Reset password mandiri (publik) ----
    requestPasswordReset: async (_: unknown, { email }: { email: string }, context: GraphQLContext) => {
      try {
        // Tidak menunggu pengiriman email → isi & waktu respons sama untuk email apa pun.
        await PasswordReset.requestReset(email, { ip: context.ip });
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
        return { success: false, message: 'Requested role is not allowed for public sign-up', errorCode: 'INVALID_ROLE' };
      }

      // Signed in: an admin creating a team account (users.manage).
      if (adminCreate) {
        if (!requestedRole || !canManageUser(context.actor, null, { kind: 'create', role: requestedRole }, 0)) {
          throw forbidden('Forbidden: users.manage');
        }
        if (!TEAM_CREATE_ROLES.includes(requestedRole)) {
          return { success: false, message: 'Only admin, crew, editor or viewer accounts can be created here', errorCode: 'INVALID_ROLE' };
        }
      }

      // Story 6.3: public sign-up can be switched off (SHOTSTASH_FEATURE_SIGNUP=false);
      // admins still create accounts.
      const refusal = publicSignupRefusal(adminCreate, config().features.signup);
      if (refusal) return refusal;

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
        if (error instanceof AuthService.PasswordRuleError || error instanceof AuthService.EmailTakenError) {
          return { success: false, message: error.message, errorCode: error.code };
        }
        log.error('register: unexpected failure', { err: errMessage(error) });
        return { success: false, message: 'Internal error', errorCode: 'INTERNAL' };
      }
    },

    createProject: async (_: any, { input }: any, context: GraphQLContext) => {
      assertCan(context.actor, 'section.create');
      const cover = isRenderableImageUrl(input.coverImage) ? input.coverImage : undefined;
      return ProjectService.createProject(input.title, input.description, cover);
    },

    createFolder: async (_: any, { projectId, name, parentId }: any, context: GraphQLContext) => {
      assertCan(context.actor, 'section.create');
      await assertProject(projectId);
      if (parentId) {
        const parent = await assertLiveFolder(parentId, 'Parent Section');
        if (parent.projectId !== projectId) throw notFound('Parent Section not found');
      }
      return FolderService.createFolder(projectId, name, parentId);
    },

    renameFolder: async (_: any, { folderId, name }: { folderId: string; name: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.move');
      await assertLiveFolder(folderId);
      return prisma.folder.update({
        where: { id: folderId },
        data: { name },
        include: { children: { where: { trashedAt: null } }, files: { where: { trashedAt: null, status: 'ready' } } },
      });
    },

    initiateUpload: async (_: any, { input }: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'upload');
      await assertProject(input.projectId);
      const target = await assertLiveFolder(input.folderId);
      if (target.projectId !== input.projectId) throw notFound('Section not found');

      // Validate file type: inherited rules from the root default Sections.
      const ext = String(input.filename).split('.').pop()?.toLowerCase() || '';
      const rootType = await getRootFolderType(input.folderId);
      if (rootType) {
        const invalid = validateFileTypeForFolder(rootType, ext);
        if (invalid) throw invalid;
      }

      // Story 4.3: starting uploads is limited per user.
      const limited = await limitBy('uploadInitiate', actor.id);
      if (!limited.ok) throw rateLimited(limited.retryAfter);

      try {
        const r = await Upload.initiateUpload({
          actor,
          projectId: input.projectId,
          folderId: input.folderId,
          filename: input.filename,
          size: Number(input.totalSize),
          md5: input.md5Checksum ?? null,
          allowDuplicate: input.allowDuplicate === true,
        });
        return {
          id: r.sessionId,
          fileId: r.fileId,
          filename: input.filename,
          totalSize: r.size,
          partSize: r.partSize,
          partCount: r.partCount,
          status: 'IN_PROGRESS',
          confirmedParts: [],
          projectId: input.projectId,
          folderId: input.folderId,
          expiresAt: r.expiresAt,
        };
      } catch (err) {
        throw Upload.asGraphQLError(err);
      }
    },

    completeUpload: async (_: any, { sessionId, md5Checksum }: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'upload');
      try {
        return await Upload.completeUpload({ actor, sessionId, md5: md5Checksum ?? null });
      } catch (err) {
        throw Upload.asGraphQLError(err);
      }
    },

    createShareLink: async (_: any, { input }: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'share.manage');
      // Story 2.5: only a live target can be shared (checked before a slot is used).
      if (input.fileId) await assertLiveFile(input.fileId);
      if (input.folderId) await assertLiveFolder(input.folderId);
      if (input.projectId) await assertProject(input.projectId);
      // Story 2.7: 60 links per hour per user.
      const limited = await limitBy('shareCreate', actor.id);
      if (!limited.ok) throw rateLimited(limited.retryAfter);
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
        throw forbidden('Share link not found or not owned by the caller');
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
      if (!PUBLIC_SIGNUP_ROLES.includes(role)) throw codedError('INVALID_ROLE', 'Invalid role');
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
      // Only a PENDING sign-up can be approved. The status check and the write
      // are one statement, so a concurrent approve or reject (or approving a
      // sign-up another admin already rejected) finds nothing to update.
      const { count } = await prisma.user.updateMany({
        where: { id: userId, accountStatus: 'PENDING' },
        data: {
          role: role as MamRole,
          accountStatus: 'ACTIVE',
          active: true,
          approvedById: actorOf(context).id,
          approvedAt: new Date(),
        },
      });
      if (count === 0) throw codedError('ALREADY_HANDLED', 'User is no longer pending');
      return prisma.user.findUnique({ where: { id: userId } });
    },

    rejectUser: async (_: any, { userId }: any, context: GraphQLContext) => {
      await assertManageUser(context, userId, { kind: 'reject' });
      // Only a PENDING sign-up can be rejected (atomic status check, see
      // approveUser). Its sessions go too, like a deactivation.
      const user = await AuthService.rejectUser(userId);
      if (!user) throw codedError('ALREADY_HANDLED', 'User is no longer pending');
      return user;
    },

    googleAuth: async (_: any, { idToken }: any, context: GraphQLContext) => {
      await assertLoginRate(context);
      return GoogleAuth.googleAuth(idToken);
    },

    sendMessage: async (_: any, { projectId, message, referencedFileId }: any, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'discussion.use');
      assertCan(actor, 'project.view');
      // Story 2.5: a real project only (no auto-created "Community" project),
      // and a referenced file must be a live file of that project.
      if (!projectId) throw notFound('Project not found');
      await assertProject(projectId);
      if (referencedFileId) {
        const file = await assertLiveFile(referencedFileId);
        if (file.projectId !== projectId) throw notFound('File not found');
      }
      if (typeof message !== 'string' || !message.trim()) {
        throw new GraphQLError('Message is empty', { extensions: { code: 'BAD_USER_INPUT' } });
      }
      if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
        throw new GraphQLError(`Message is longer than ${MAX_CHAT_MESSAGE_LENGTH} characters`, {
          extensions: { code: 'MESSAGE_TOO_LONG', maxLength: MAX_CHAT_MESSAGE_LENGTH },
        });
      }
      return ChatService.sendMessage(actor.id, projectId, message, referencedFileId || undefined);
    },

    updateProfile: async (
      _: any,
      { name, avatarUrl, locale }: { name?: string; avatarUrl?: string; locale?: string | null },
      context: GraphQLContext,
    ) => {
      assertCanWriteSelf(context.actor);
      const data: any = {};
      if (typeof name === 'string') {
        const trimmed = name.trim();
        if (trimmed.length === 0) throw codedError('NAME_REQUIRED', 'Name cannot be empty');
        if (trimmed.length > 80) throw codedError('NAME_TOO_LONG', 'Name too long', { max: 80 });
        data.name = trimmed;
      }
      if (typeof avatarUrl === 'string') {
        if (avatarUrl.length > 0 && !isRenderableImageUrl(avatarUrl)) throw codedError('INVALID_AVATAR_URL', 'Invalid avatar URL');
        data.avatarUrl = avatarUrl.length > 0 ? avatarUrl : null;
      }
      // Story 3.1: '' or null clears the choice (back to the instance default).
      if (locale !== undefined) {
        const wanted = typeof locale === 'string' ? locale.trim().toLowerCase() : '';
        if (wanted === '') data.locale = null;
        else if (isSupportedLocale(wanted)) data.locale = wanted;
        else throw new GraphQLError('Unsupported locale', { extensions: { code: 'UNSUPPORTED_LOCALE' } });
      }
      if (Object.keys(data).length === 0) throw codedError('NOTHING_TO_UPDATE', 'Nothing to update');
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
      if (targetError) return targetError;
      await assertManageUser(context, userId, { kind: 'password' });
      try {
        const result = await AuthService.adminSetPassword(userId, newPassword);
        auditAdminAction('adminSetPassword', currentUser, result.email);
        return {
          success: true,
          message: `Password set for ${result.email}; all of their sessions were signed out`,
          errorCode: null,
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
      if (targetError) return targetError;
      await assertManageUser(context, id, { kind: 'delete' });
      try {
        const result = await AuthService.deleteUserAccount(id);
        auditAdminAction('deleteUser', currentUser, result.email);
        return { success: true, message: `Account ${result.email} deleted`, password: null, errorCode: null };
      } catch (error) {
        return adminActionFailure('deleteUser', error);
      }
    },

    updateProject: async (_: any, { id, input }: any, context: GraphQLContext) => {
      assertCan(context.actor, 'item.move');
      await assertProject(id);
      return prisma.project.update({
        where: { id },
        data: { title: input.title, description: input.description },
      });
    },

    deleteProject: async (_: any, { id }: { id: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.purge');
      // Story 2.8: links revoked, rows deleted, then bytes and the project directory.
      return Trash.purgeProject(id);
    },

    // Story 2.8: every trash operation goes through the trash module.
    moveToTrash: async (_: any, { fileId }: { fileId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      return Trash.trashFile(fileId);
    },

    restoreFile: async (_: any, { fileId }: { fileId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      return Trash.restoreFile(fileId);
    },

    permanentDelete: async (_: any, { fileId }: { fileId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.purge');
      const file = await prisma.mediaFile.findUnique({ where: { id: fileId }, select: { trashedAt: true } });
      if (!file) return true;
      if (!file.trashedAt) throw Trash.trashError('NOT_IN_TRASH', 'Move the file to the Trash first');
      await Trash.purgeRoots({ fileIds: [fileId] });
      return true;
    },

    moveFolderToTrash: async (_: any, { folderId }: { folderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      return Trash.trashFolder(folderId);
    },

    restoreFolder: async (_: any, { folderId }: { folderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.trash');
      return Trash.restoreFolder(folderId);
    },

    permanentDeleteFolder: async (_: any, { folderId }: { folderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'trash.purge');
      const folder = await prisma.folder.findUnique({ where: { id: folderId }, select: { trashedAt: true } });
      if (!folder) return true;
      if (!folder.trashedAt) throw Trash.trashError('NOT_IN_TRASH', 'Move the Section to the Trash first');
      await Trash.purgeRoots({ folderIds: [folderId] });
      return true;
    },

    enqueueJob: async (_: unknown, { fileId, kind }: { fileId: string; kind: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'pipeline.trigger');
      const file = await assertLiveFile(fileId);
      try {
        return await Pipeline.enqueueJob({ fileId: file.id, kind, createdById: actor.id });
      } catch (err) {
        throw jobError(err);
      }
    },

    cancelJob: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'pipeline.trigger');
      // Like the other job queries: a job of a trashed or deleted file is not found.
      const job = await Pipeline.jobById(id);
      if (!job) throw notFound('Job not found');
      await assertLiveFile(job.fileId);
      try {
        return await Pipeline.cancelJob(id);
      } catch (err) {
        throw jobError(err);
      }
    },

    revokeWorker: async (_: unknown, { id }: { id: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'instance.configure');
      return Pipeline.revokeWorker(id);
    },

    cancelUpload: async (_: any, { sessionId }: { sessionId: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'upload');
      try {
        await Upload.cancelUpload(actor, sessionId);
        return true;
      } catch (err) {
        throw Upload.asGraphQLError(err);
      }
    },

    // Story 4.1: storage keys never encode hierarchy, so moves and renames
    // are database-only; bytes stay where they are.
    moveFile: async (_: any, { fileId, targetFolderId }: { fileId: string; targetFolderId: string }, context: GraphQLContext) => {
      assertCan(context.actor, 'item.move');
      const file = await assertLiveFile(fileId);
      const targetFolder = await assertLiveFolder(targetFolderId, 'Target Section');
      return prisma.$transaction(async (tx) => {
        const cross = targetFolder.projectId !== file.projectId;
        const parked = cross ? await Upload.detachForMove(tx, [fileId]) : [];
        if (cross) await Upload.markConflictsAsDuplicates(tx, [fileId], targetFolder.projectId);
        const moved = await tx.mediaFile.update({
          where: { id: fileId },
          data: { folderId: targetFolderId, projectId: targetFolder.projectId },
        });
        await Upload.resettle(tx, parked);
        return tx.mediaFile.findUniqueOrThrow({ where: { id: moved.id }, include: { folder: true, project: true, uploadedBy: true } });
      }).then((row) => {
        Library.syncSearchLater([row.id]);
        return row;
      });
    },

    // A copy duplicates the bytes (and the thumbnail) through the storage
    // backend under the new file's own keys.
    copyFile: async (_: any, { fileId, targetFolderId }: { fileId: string; targetFolderId: string }, context: GraphQLContext) => {
      const actor = actorOf(context);
      assertCan(actor, 'upload');
      const file = await assertLiveFile(fileId);
      const targetFolder = await assertLiveFolder(targetFolderId, 'Target Section');

      const store = storage();
      const newId = uuidv7();
      const ext = file.storageKey.split('.').pop() || 'bin';
      const key = storageKeys.original(newId, ext);
      try {
        await store.copy(file.storageKey, key);
      } catch (err) {
        log.error('copyFile: storage copy failed', { err: errMessage(err) });
        throw codedError('STORAGE_UNAVAILABLE', 'The file could not be copied');
      }
      let thumbVersion = 0;
      if (file.thumbVersion) {
        try {
          await store.copy(storageKeys.thumbnail(file.id, file.thumbVersion), storageKeys.thumbnail(newId, 1));
          thumbVersion = 1;
        } catch (err) {
          log.warn('copyFile: thumbnail copy failed', { err: errMessage(err) });
        }
      }

      // Story 4.4: processed versions travel with the copy (bytes and rows).
      const versions = await prisma.processedVersion.findMany({ where: { mediaFileId: file.id } });
      const copiedVersions: { id: string; kind: string; jobId: string | null; attempt: number; storageKey: string; mimeType: string; size: bigint; createdAt: Date }[] = [];
      for (const v of versions) {
        const versionId = uuidv7();
        const vKey = storageKeys.processed(newId, versionId, v.storageKey.split('.').pop() || 'bin');
        try {
          await store.copy(v.storageKey, vKey);
          copiedVersions.push({ id: versionId, kind: v.kind, jobId: v.jobId, attempt: v.attempt, storageKey: vKey, mimeType: v.mimeType, size: v.size, createdAt: v.createdAt });
        } catch (err) {
          log.warn('copyFile: processed version copy failed', { err: errMessage(err) });
        }
      }

      try {
        const copy = await prisma.$transaction(async (tx) => {
          const original = await Upload.findOriginal(tx, targetFolder.projectId, file.md5Checksum);
          const row = await tx.mediaFile.create({
            data: {
              id: newId,
              filename: `${newId}.${ext}`,
              originalName: file.originalName,
              mimeType: file.mimeType,
              size: file.size,
              md5Checksum: file.md5Checksum,
              storageKey: key,
              thumbVersion,
              status: 'ready',
              duplicateOfId: original?.id ?? null,
              folderId: targetFolderId,
              projectId: targetFolder.projectId,
              uploadedById: actor.id,
            },
            include: { folder: true, project: true, uploadedBy: true },
          });
          if (copiedVersions.length) {
            await tx.processedVersion.createMany({ data: copiedVersions.map((v) => ({ ...v, mediaFileId: newId })) });
          }
          return row;
        });
        Library.syncSearchLater([copy.id]);
        return copy;
      } catch (err) {
        await store.delete(key).catch(() => {});
        if (thumbVersion) await store.delete(storageKeys.thumbnail(newId, 1)).catch(() => {});
        for (const v of copiedVersions) await store.delete(v.storageKey).catch(() => {});
        throw err;
      }
    },

    moveFolder: async (
      _: any,
      { folderId, targetFolderId, targetProjectId }: { folderId: string; targetFolderId?: string | null; targetProjectId?: string | null },
      context: GraphQLContext,
    ) => {
      assertCan(context.actor, 'item.move');
      const folder = await assertLiveFolder(folderId);

      if (!targetFolderId && !targetProjectId) {
        throw codedError('INVALID_MOVE_TARGET', 'Provide either targetFolderId or targetProjectId');
      }
      if (targetFolderId && targetFolderId === folderId) {
        throw codedError('MOVE_INTO_ITSELF', 'Cannot move a Section into itself');
      }

      // Resolve destination: either inside a folder or at a project root
      let destProjectId: string;
      if (targetFolderId) {
        const targetFolder = await assertLiveFolder(targetFolderId, 'Target Section');
        destProjectId = targetFolder.projectId;

        // Prevent cycle: target must not be a descendant of the folder being moved
        let cursor: { id: string; parentId: string | null } | null = targetFolder;
        while (cursor?.parentId) {
          if (cursor.parentId === folderId) {
            throw codedError('MOVE_INTO_ITSELF', 'Cannot move a Section into its own descendant');
          }
          cursor = await prisma.folder.findUnique({
            where: { id: cursor.parentId },
            select: { id: true, parentId: true },
          });
        }
      } else {
        const targetProject = await prisma.project.findUnique({ where: { id: targetProjectId! } });
        if (!targetProject) throw codedError('NOT_FOUND', 'Target project not found');
        destProjectId = targetProject.id;
      }

      const crossProject = destProjectId !== folder.projectId;

      // Every folder in the moved subtree (including self), for the projectId cascade.
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

      // Database only: storage keys do not depend on where a file sits.
      // Story 4.5: every file of the moved subtree is resynced, whether or not the Project changed.
      const movedFiles = (await prisma.mediaFile.findMany({ where: { folderId: { in: subtreeFolderIds } }, select: { id: true } })).map((f) => f.id);
      await prisma.$transaction(async (tx) => {
        await tx.folder.update({
          where: { id: folderId },
          data: { parentId: targetFolderId ?? null, projectId: destProjectId },
        });
        if (crossProject) {
          const moving = await tx.mediaFile.findMany({ where: { folderId: { in: subtreeFolderIds } }, select: { id: true } });
          const parked = await Upload.detachForMove(tx, moving.map((f) => f.id));
          await Upload.markConflictsAsDuplicates(tx, moving.map((f) => f.id), destProjectId);
          await tx.folder.updateMany({ where: { id: { in: subtreeFolderIds } }, data: { projectId: destProjectId } });
          await tx.mediaFile.updateMany({ where: { folderId: { in: subtreeFolderIds } }, data: { projectId: destProjectId } });
          await Upload.resettle(tx, parked);
          await tx.uploadSession.updateMany({ where: { folderId: { in: subtreeFolderIds } }, data: { projectId: destProjectId } });
        }
      });
      Library.syncSearchLater(movedFiles);

      return prisma.folder.findUnique({
        where: { id: folderId },
        include: { children: { where: { trashedAt: null } }, files: { where: { trashedAt: null, status: 'ready' } } },
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
    // Story 6.3: instance feature toggles; the schema is the same whatever they are.
    features: () => config().features,
  },

  Project: {
    files: async (parent: any) => {
      return prisma.mediaFile.findMany({
        where: { projectId: parent.id, trashedAt: null, status: 'ready' },
        take: 50,
        orderBy: { createdAt: 'desc' },
      });
    },
    totalFiles: async (parent: any) => {
      // Story 2.4: file di Trash tidak dihitung (paritas Project.files yang
      // menyaring trashedAt: null) — angka beberapa project turun; itu
      // memang perbaikannya (keputusan user 21 Sep 2026).
      return prisma.mediaFile.count({ where: { projectId: parent.id, trashedAt: null, status: 'ready' } });
    },
    totalSize: async (parent: any) => {
      const result = await prisma.mediaFile.aggregate({
        where: { projectId: parent.id, trashedAt: null, status: 'ready' },
        _sum: { size: true },
      });
      return Number(result._sum.size || 0);
    },
    // Story 2.4: SATU groupBy atas seluruh file project lintas Section
    // (setiap mediaFile membawa projectId); server hanya angka mentah.
    contentSummary: async (parent: any) => {
      const rows = await prisma.mediaFile.groupBy({
        by: ['mimeType'],
        where: { projectId: parent.id, trashedAt: null, status: 'ready' },
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
        where: { folderId: { in: ids }, trashedAt: null, status: 'ready' },
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
    thumbnailUrl: (parent: any) => (parent.thumbVersion ? mediaUrl.thumbnail(parent.id, parent.thumbVersion) : null),
    duplicateOf: (parent: any) => (parent.duplicateOfId && parent.duplicateOfId !== parent.id ? parent.duplicateOfId : null),
    downloadUrl: (parent: any) => mediaUrl.download(parent.id),
    // Story 4.4: included by `folder(id)` (one query for every file of the
    // Section); elsewhere one batched query per request.
    processedVersions: async (parent: any, _: unknown, context: GraphQLContext) => processedVersionsOf(parent, context),
    previewUrl: async (parent: any, _: unknown, context: GraphQLContext) => {
      const preview = previewOf(await processedVersionsOf(parent, context));
      return preview ? mediaUrl.processed(preview.id) : null;
    },
    jobs: async (parent: { id: string }) => Pipeline.jobsForFile(parent.id),
    uploadedBy: async (parent: any) => {
      if (parent.uploadedBy) return parent.uploadedBy;
      if (!parent.uploadedById) return null;
      return prisma.user.findUnique({ where: { id: parent.uploadedById } });
    },
  },

  ProcessedVersion: {
    downloadUrl: (parent: { id: string }) => mediaUrl.processed(parent.id),
    kindLabel: (parent: { kind: string }) => Pipeline.kindLabel(parent.kind).catch(() => null),
  },

  PipelineJob: {
    outputVersion: async (parent: { outputVersionId: string | null }) =>
      parent.outputVersionId ? prisma.processedVersion.findUnique({ where: { id: parent.outputVersionId } }) : null,
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
        return file && !file.trashedAt && file.status === 'ready' ? [toRepFile(file)] : [];
      }

      if (parent.folderId) {
        const folder =
          parent.folder !== undefined
            ? parent.folder
            : await prisma.folder.findUnique({ where: { id: parent.folderId } });
        // A trashed target shows no thumbnails (Story 2.8).
        if (!folder || folder.trashedAt) return [];
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
    // A trashed file is not shown as an attachment (Story 2.5).
    referencedFile: async (parent: any) => {
      const file =
        parent.referencedFile !== undefined
          ? parent.referencedFile
          : parent.referencedFileId
            ? await prisma.mediaFile.findUnique({ where: { id: parent.referencedFileId } })
            : null;
      return file && !file.trashedAt && file.status === 'ready' ? file : null;
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
      subscribe: async (_: any, { projectId }: { projectId: string }, context: GraphQLContext) => {
        assertCan(context?.actor, 'project.view');
        // Story 2.5: only an existing project (projects themselves are never trashed).
        await assertProject(projectId);
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

// Story 2.5: the project list type shares every Project resolver (it has no chats).
const withSummary = { ...rawResolvers, ProjectSummary: rawResolvers.Project };

// Story 2.1: every root field passes the auth mode declared in auth-map.ts.
export const resolvers = applyAuthMap(withSummary);
