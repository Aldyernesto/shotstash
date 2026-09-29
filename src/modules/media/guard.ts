/**
 * `mediaGuard`: the single gate in front of media bytes (Stories 2.2 / 2.3).
 *
 *   cookie  the `shotstash_session` actor must pass `can(media.download)`;
 *   signed  a `/media/s/<token>` token must verify and the ShareLink row is
 *           re-read (revoked, expired, target trashed) on every request.
 *
 * Trashed or missing targets (including a trashed ancestor Section) answer 404.
 */

import prisma from '@/lib/prisma';
import { coverIdFromUrl, coverUrl } from './coverUrl.ts';
import { COVER_KINDS, storageKeys, type CoverKind } from '@/modules/storage';
import { folderChainTrashed, findLiveShare, shareFileInScope, shareZipPlan } from '@/lib/shareLink';
import { zipFileName, zipPlanForFolders } from '@/lib/mediaTree';
import { can, type Actor } from '@/modules/auth';
import { isZipTarget, verifyShareToken } from './signing';
import { fileResponse, forbiddenResponse, notFoundResponse, zipResponse } from './stream';

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

export type GuardedFile = {
  id: string;
  originalName: string;
  mimeType: string;
  storageKey: string;
  thumbVersion: number;
  projectId: string;
  folderId: string;
};

export type GuardResult = { ok: true; file: GuardedFile } | { ok: false; response: Response };

/** Cookie actor + `can(media.download)` + live (not trashed) file. */
export async function mediaGuard(actor: Actor | null, fileId: string): Promise<GuardResult> {
  if (!actor) {
    return {
      ok: false,
      response: Response.json({ code: 'UNAUTHENTICATED', message: 'Authentication required' }, { status: 401 }),
    };
  }
  if (!can(actor, 'media.download')) return { ok: false, response: forbiddenResponse() };
  if (!ID_RE.test(fileId)) return { ok: false, response: notFoundResponse() };

  const file = await prisma.mediaFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      storageKey: true,
      thumbVersion: true,
      projectId: true,
      folderId: true,
      trashedAt: true,
      status: true,
    },
  });
  if (!file || file.status !== 'ready' || file.trashedAt || (await folderChainTrashed(file.folderId))) {
    return { ok: false, response: notFoundResponse() };
  }
  const { trashedAt: _t, status: _s, ...rest } = file;
  void _t;
  void _s;
  return { ok: true, file: rest };
}

/** Serves one guarded file: thumbnail, inline original or attachment. */
export async function serveFile(req: Request, file: GuardedFile, variant: 'thumbnail' | 'inline' | 'download', cache: 'cookie' | 'signed') {
  if (variant === 'thumbnail') {
    if (!file.thumbVersion) return notFoundResponse();
    return fileResponse({ req, key: storageKeys.thumbnail(file.id, file.thumbVersion), mimeType: 'image/jpeg', cache });
  }
  return fileResponse({
    req,
    key: file.storageKey,
    mimeType: file.mimeType,
    cache,
    disposition: { kind: variant === 'inline' ? 'inline' : 'attachment', filename: file.originalName },
  });
}

/** `/media/s/<token>`: signed share media or share ZIP. Anything invalid answers 404. */
export async function signedMediaResponse(req: Request, token: string): Promise<Response> {
  const verified = verifyShareToken(token);
  if (!verified) return notFoundResponse();
  const link = await findLiveShare({ id: verified.shareId });
  if (!link) return notFoundResponse();

  if (isZipTarget(verified.target)) {
    const sectionId = verified.target.startsWith('zip:') ? verified.target.slice(4) : null;
    const plan = await shareZipPlan(link, sectionId);
    if (!plan) return notFoundResponse();
    return zipResponse({ entries: plan.entries, emptyDirs: plan.emptyDirs, zipName: plan.zipName, cache: 'signed' });
  }

  const thumb = verified.target.startsWith('t:');
  const fileId = thumb ? verified.target.slice(2) : verified.target;
  const file = await shareFileInScope(link, fileId);
  if (!file) return notFoundResponse();
  const dl = new URL(req.url).searchParams.get('dl') === '1';
  return serveFile(
    req,
    { ...file, projectId: '', folderId: '' },
    thumb ? 'thumbnail' : dl ? 'download' : 'inline',
    'signed',
  );
}

/** Dashboard ZIP (`/media/z`): `projectId` plus `folderId` or `fileIds`; trashed items excluded. */
export async function projectZipResponse(
  actor: Actor | null,
  query: { projectId: string | null; folderId: string | null; fileIds: string[] },
): Promise<Response> {
  if (!actor) return Response.json({ code: 'UNAUTHENTICATED', message: 'Authentication required' }, { status: 401 });
  if (!can(actor, 'media.download')) return forbiddenResponse();
  const { projectId, folderId, fileIds } = query;
  if (!projectId || !ID_RE.test(projectId)) {
    return Response.json({ code: 'BAD_REQUEST', message: 'projectId is required' }, { status: 400 });
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { title: true } });
  if (!project) return notFoundResponse();

  if (folderId) {
    const folder = await prisma.folder.findUnique({ where: { id: folderId }, select: { projectId: true, name: true } });
    if (!folder || folder.projectId !== projectId || (await folderChainTrashed(folderId))) return notFoundResponse();
    const plan = await zipPlanForFolders([folderId]);
    return zipResponse({ ...plan, zipName: zipFileName(folder.name), cache: 'cookie' });
  }

  const ids = fileIds.filter((id) => ID_RE.test(id)).slice(0, 1000);
  if (!ids.length) return Response.json({ code: 'BAD_REQUEST', message: 'folderId or fileIds is required' }, { status: 400 });
  const files = await prisma.mediaFile.findMany({
    where: { id: { in: ids }, projectId, trashedAt: null, status: 'ready' },
    select: { originalName: true, storageKey: true, folderId: true },
  });
  const live: { key: string; name: string }[] = [];
  const used = new Set<string>();
  for (const f of files) {
    if (await folderChainTrashed(f.folderId)) continue;
    let name = f.originalName.replace(/[\\/]/g, '_');
    let n = 2;
    while (used.has(name)) name = `${n++}_${f.originalName.replace(/[\\/]/g, '_')}`;
    used.add(name);
    live.push({ key: f.storageKey, name });
  }
  if (!live.length) return notFoundResponse();
  return zipResponse({ entries: live, zipName: zipFileName(project.title), cache: 'cookie' });
}

/* ------------------------------------------------------------------ */
/* Covers (project covers and user avatars)                            */
/* ------------------------------------------------------------------ */

export { COVER_KINDS };
export type { CoverKind };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export { coverIdFromUrl, coverUrl };

/** Cover bytes by key (`covers/<kind>/<uuid>.jpg`). */
export async function coverResponse(req: Request, actor: Actor | null, kind: string, id: string): Promise<Response> {
  if (!actor) return Response.json({ code: 'UNAUTHENTICATED', message: 'Authentication required' }, { status: 401 });
  if (!can(actor, 'project.view')) return forbiddenResponse();
  if (!(COVER_KINDS as readonly string[]).includes(kind) || !UUID_RE.test(id)) return notFoundResponse();
  return fileResponse({ req, key: storageKeys.cover(kind as CoverKind, id), mimeType: 'image/jpeg', cache: 'cookie' });
}
