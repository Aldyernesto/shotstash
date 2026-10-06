/**
 * Story 8.2: seed and reset of a public demo instance.
 *
 *   seed   the read-only demo accounts (upserted) and the demo Project with
 *          synthetic media: stills, clips, a PDF, thumbnails, one 720p proxy
 *          (a processed version), a public share link and a discussion.
 *          Idempotent: an existing demo Project is purged first.
 *   reset  everything the demo accounts and the demo Project left behind
 *          (the Project's rows and bytes, demo sessions, notifications,
 *          share links, uploads and password resets), then seed again.
 *
 * Never touches `instance_settings`, a super admin or any account that is
 * not a read-only demo account. Refuses to run outside demo mode or before
 * first-run setup (`DemoError`).
 */
import { createHash } from 'crypto';
import { Readable } from 'stream';
import * as bcrypt from 'bcryptjs';
import { v7 as uuidv7 } from 'uuid';
import prisma from '@/lib/prisma';
import { config } from '@/lib/config';
import { DEMO_ACCOUNTS, DEMO_EMAILS, DEMO_PROJECT_ID, DEMO_SESSION_MINUTES, DEMO_VIEWER_EMAIL } from '@/lib/demoAccounts';
import { createSessionRow } from '@/lib/sessionStore';
import { logger } from '@/lib/logger';
import { storage, storageKeys } from '@/modules/storage';
import { generateThumbnail } from '@/modules/media';
import { purgeProject } from '@/modules/trash';
import { syncSearch } from '@/modules/library';
import { SECTIONS, ffmpegToBuffer, proxyArgs, sampleFiles, type SampleFile, type SectionKey } from './media.ts';

const log = logger('demo');

export const PROXY_KIND = 'shotstash/proxy-720p';

/** Why the CLI refuses (not an API error code: the demo command prints the message). */
export type DemoRefusal = 'mode-off' | 'password-too-short' | 'setup-required' | 'no-demo-account';

export class DemoError extends Error {
  readonly reason: DemoRefusal;
  constructor(reason: DemoRefusal, message: string) {
    super(message);
    this.name = 'DemoError';
    this.reason = reason;
  }
}

/** Fixed slug of the seeded public share link, the same after every reset. */
export const DEMO_SHARE_SLUG = 'demo-coastline-stills';

export type SeedResult = {
  accounts: string[];
  skipped: string[];
  projectId: string;
  files: number;
  shareSlug: string;
};

async function assertReady(): Promise<string> {
  const c = config();
  if (!c.features.demo) throw new DemoError('mode-off', 'Refusing to run: set SHOTSTASH_DEMO_MODE=true.');
  const password = c.DEMO_ADMIN_PASSWORD ?? '';
  if (password.length < 10) {
    throw new DemoError('password-too-short', 'Refusing to run: DEMO_ADMIN_PASSWORD must have at least 10 characters.');
  }
  const setup = await prisma.instanceSetting.findUnique({ where: { id: 1 } });
  if (!setup) throw new DemoError('setup-required', 'Refusing to run: complete first-run setup at /setup first.');
  return password;
}

/** Upserts the demo accounts. An account with a demo address that is not a read-only demo account is left alone. */
async function upsertAccounts(password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  const ids: Record<string, string> = {};
  const skipped: string[] = [];
  for (const u of DEMO_ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { email: u.email }, select: { role: true, readOnly: true } });
    // Never take over a real account that happens to use a demo address.
    if (existing && (existing.role === 'SUPER_ADMIN' || !existing.readOnly)) {
      log.warn('skipped an account: it uses a demo address but is not a read-only demo account', { email: u.email });
      skipped.push(u.email);
      continue;
    }
    const data = {
      name: u.name,
      role: u.role,
      passwordHash,
      googleId: null,
      active: true,
      accountStatus: 'ACTIVE' as const,
      onboardedAt: now,
      readOnly: true,
      avatarUrl: null,
      locale: null,
    };
    const row = await prisma.user.upsert({ where: { email: u.email }, update: data, create: { email: u.email, ...data } });
    ids[u.email] = row.id;
  }
  return { ids, skipped };
}

/** Ids of the read-only demo accounts that exist now. */
async function demoAccountIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { email: { in: [...DEMO_EMAILS] }, readOnly: true, role: { not: 'SUPER_ADMIN' } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function removeDemoProject() {
  const exists = await prisma.project.findUnique({ where: { id: DEMO_PROJECT_ID }, select: { id: true } });
  if (exists) await purgeProject(DEMO_PROJECT_ID);
  // Upload sessions keep no foreign key to the Project.
  await prisma.uploadSession.deleteMany({ where: { projectId: DEMO_PROJECT_ID } });
}

/** Seeds the demo accounts and the demo Project (replacing an earlier one). */
export async function seedDemo(): Promise<SeedResult> {
  const password = await assertReady();
  // Everything slow or fallible first: nothing is removed until the media exists.
  const samples = await sampleFiles();
  return seedWith(password, samples);
}

/** Removes what the demo left behind, then seeds again. */
export async function resetDemo(): Promise<SeedResult> {
  const password = await assertReady();
  const samples = await sampleFiles();
  const ids = await demoAccountIds();
  await removeDemoProject();
  if (ids.length) {
    await prisma.shareLink.deleteMany({ where: { createdById: { in: ids } } });
    await prisma.uploadSession.deleteMany({ where: { uploadedById: { in: ids } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.passwordResetRequest.deleteMany({ where: { userId: { in: ids } } });
  }
  return seedWith(password, samples);
}

async function seedWith(password: string, samples: SampleFile[]): Promise<SeedResult> {
  const { ids, skipped } = await upsertAccounts(password);
  const adminId = ids['demo-admin@example.com'] ?? Object.values(ids)[0];
  if (!adminId) throw new DemoError('no-demo-account', 'No demo account could be created (every demo address is taken by another account).');
  const editorId = ids['demo-editor@example.com'] ?? adminId;

  await removeDemoProject();
  // The fixed slug is free again (purging a project only revokes its links).
  await prisma.shareLink.deleteMany({ where: { slug: DEMO_SHARE_SLUG } });

  const written: string[] = [];
  const put = async (key: string, bytes: Buffer, contentType: string) => {
    written.push(key);
    await storage().putStream(key, Readable.from(bytes), { contentType, size: bytes.length });
  };
  try {
    await prisma.project.create({
      data: {
        id: DEMO_PROJECT_ID,
        title: 'Coastline promo',
        description: 'Sample project of the public demo: generated stills, clips and a shot list. Demo accounts are read-only.',
      },
    });
    const sections = {} as Record<SectionKey, string>;
    for (const [key, name] of Object.entries(SECTIONS) as [SectionKey, string][]) {
      sections[key] = (await prisma.folder.create({ data: { name, projectId: DEMO_PROJECT_ID } })).id;
    }

    const fileIds: Record<string, string> = {};
    const start = Date.now() - samples.length * 60_000;
    for (const [i, s] of samples.entries()) {
      const id = uuidv7();
      const key = storageKeys.original(id, s.ext);
      await put(key, s.bytes, s.mimeType);
      const thumbVersion = await generateThumbnail({ id, storageKey: key, mimeType: s.mimeType, thumbVersion: 0 });
      if (thumbVersion) written.push(storageKeys.thumbnail(id, thumbVersion));
      await prisma.mediaFile.create({
        data: {
          id,
          filename: `${id}.${s.ext}`,
          originalName: s.name,
          mimeType: s.mimeType,
          size: BigInt(s.bytes.length),
          md5Checksum: createHash('md5').update(s.bytes).digest('hex'),
          storageKey: key,
          thumbVersion,
          status: 'ready',
          folderId: sections[s.section],
          projectId: DEMO_PROJECT_ID,
          uploadedById: s.section === 'footage' ? editorId : adminId,
          createdAt: new Date(start + i * 60_000),
        },
      });
      fileIds[s.name] = id;
      if (s.proxy) {
        // Read through the storage backend (a local path, or a short-lived signed URL on S3).
        const proxy = await storage().withLocalInput(key, (input) => ffmpegToBuffer(proxyArgs(input)), { ttlSeconds: 300 });
        const versionId = uuidv7();
        const proxyKey = storageKeys.processed(id, versionId, 'mp4');
        await put(proxyKey, proxy, 'video/mp4');
        await prisma.processedVersion.create({
          data: { id: versionId, mediaFileId: id, kind: PROXY_KIND, storageKey: proxyKey, mimeType: 'video/mp4', size: BigInt(proxy.length) },
        });
      }
    }

    const share = await prisma.shareLink.create({
      data: { slug: DEMO_SHARE_SLUG, mode: 'PUBLIC', folderId: sections.stills, createdById: adminId },
    });

    const clipId = Object.entries(fileIds).find(([name]) => name.endsWith('.mp4'))?.[1] ?? null;
    const messages = [
      { senderId: editorId, message: 'First pass on the harbor wide is up, with a 720p proxy for review.', referencedFileId: clipId },
      { senderId: adminId, message: 'Looks good. The stills folder is shared with the client already.', referencedFileId: null },
      { senderId: editorId, message: 'Shot list for day two is in 03 Documents.', referencedFileId: null },
    ];
    for (const [i, m] of messages.entries()) {
      await prisma.projectChat.create({
        data: { projectId: DEMO_PROJECT_ID, ...m, seq: BigInt(i + 1), createdAt: new Date(Date.now() - (messages.length - i) * 5 * 60_000) },
      });
    }
    await prisma.project.update({ where: { id: DEMO_PROJECT_ID }, data: { chatSeq: BigInt(messages.length) } });

    await syncSearch(Object.values(fileIds)).catch(() => undefined);
    return { accounts: Object.keys(ids), skipped, projectId: DEMO_PROJECT_ID, files: samples.length, shareSlug: share.slug };
  } catch (err) {
    // Leave no orphan bytes or half a project behind.
    for (const key of written) await storage().delete(key).catch(() => undefined);
    await prisma.shareLink.deleteMany({ where: { slug: DEMO_SHARE_SLUG } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: DEMO_PROJECT_ID } }).catch(() => undefined);
    throw err;
  }
}

/** The read-only demo viewer behind the docs try-it console, or null before the seed. */
export async function findDemoViewer(): Promise<{ id: string } | null> {
  const viewer = await prisma.user.findUnique({
    where: { email: DEMO_VIEWER_EMAIL },
    select: { id: true, readOnly: true, active: true, role: true, accountStatus: true },
  });
  if (!viewer || !viewer.readOnly || !viewer.active || viewer.role === 'SUPER_ADMIN' || viewer.accountStatus !== 'ACTIVE') return null;
  return { id: viewer.id };
}

/** A fixed-expiry (never sliding) session of the demo viewer for the docs try-it console. */
export function createDemoSession(viewerId: string, meta: { ip?: string; userAgent?: string }) {
  return createSessionRow(viewerId, meta, { ttlMs: DEMO_SESSION_MINUTES * 60_000 });
}

/**
 * The demo accounts to publish on the sign-in page: only those that exist as
 * active read-only accounts (never an address a real account owns), in the
 * fixed order of `DEMO_ACCOUNTS`.
 */
export async function publishedDemoAccounts(): Promise<{ email: string; role: string }[]> {
  const rows = await prisma.user.findMany({
    where: { email: { in: [...DEMO_EMAILS] }, readOnly: true, active: true, accountStatus: 'ACTIVE', role: { not: 'SUPER_ADMIN' } },
    select: { email: true, role: true },
  });
  return DEMO_ACCOUNTS.flatMap((a) => rows.filter((r) => r.email === a.email).map((r) => ({ email: r.email, role: String(r.role) })));
}
