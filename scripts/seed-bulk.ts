/**
 * 10,000-file development seed (Story 4.5): one Project with one Section
 * holding BULK_COUNT (default 10,000) small photos, each with distinct bytes
 * (so the per-Project dedup index accepts them) and a real thumbnail, all
 * written through the storage backend. Used to measure the library with a
 * production build.
 *
 * Safety gates (exit code 2): refuses NODE_ENV=production and any
 * DATABASE_URL whose host is not 127.0.0.1 or localhost.
 *
 *   npm run dev:seed:bulk                 10,000 files
 *   BULK_COUNT=500 npm run dev:seed:bulk  fewer
 *
 * Re-running replaces the bulk Project (fixed id) and its bytes.
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'crypto';
import { Readable } from 'stream';

function refuse(reason: string): never {
  console.error(`Refusing to seed: ${reason}`);
  process.exit(2);
}

if (process.env.NODE_ENV === 'production') refuse('NODE_ENV=production.');
{
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    host = '';
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    refuse(`DATABASE_URL must point at 127.0.0.1 or localhost (got: ${host || 'unset or invalid'}).`);
  }
}

const PROJECT_ID = 'b0000000-0000-4000-8000-00000000b10c';
const COUNT = Math.max(1, Math.min(50_000, Number(process.env.BULK_COUNT) || 10_000));
const PALETTE = ['#3563f2', '#1f9d74', '#d9822b', '#b03a8c', '#5a6b7d', '#2b8fd9', '#8a5cd9', '#c94c4c', '#3a9e9e', '#9e8a3a'];

async function main() {
  const [{ default: prisma, disconnectPrisma }, { storage, storageKeys }, sharp] = await Promise.all([
    import('../src/lib/prisma'),
    import('../src/modules/storage'),
    import('sharp').then((m) => m.default),
  ]);
  const store = storage();
  const owner = await prisma.user.findFirst({ where: { active: true, role: { in: ['SUPER_ADMIN', 'ADMIN', 'EDITOR'] } }, orderBy: { createdAt: 'asc' } });
  if (!owner) refuse('no active account (run npm run dev:seed first).');

  // Replace an earlier run.
  const old = await prisma.mediaFile.findMany({ where: { projectId: PROJECT_ID }, select: { id: true, storageKey: true, thumbVersion: true } });
  for (const f of old) {
    await store.delete(f.storageKey).catch(() => {});
    for (let v = 1; v <= f.thumbVersion; v++) await store.delete(storageKeys.thumbnail(f.id, v)).catch(() => {});
  }
  await prisma.project.deleteMany({ where: { id: PROJECT_ID } });

  const project = await prisma.project.create({
    data: { id: PROJECT_ID, title: 'Bulk library (10k)', description: 'Development seed for library performance.' },
  });
  const section = await prisma.folder.create({ data: { name: '01 Bulk photos', projectId: project.id } });

  // A few small base photos (portrait and landscape); every original gets
  // 16 random bytes after the JPEG end marker, so no two MD5s match.
  const bases: { jpeg: Buffer; thumb: Buffer }[] = [];
  for (let i = 0; i < PALETTE.length; i++) {
    const portrait = i % 3 === 0;
    const [w, h] = portrait ? [240, 320] : [320, 240];
    const jpeg = await sharp({ create: { width: w, height: h, channels: 3, background: PALETTE[i] } })
      .composite([{ input: { create: { width: Math.round(w / 3), height: Math.round(h / 3), channels: 3, background: '#ffffff' } }, left: Math.round(w / 3), top: Math.round(h / 3) }])
      .jpeg({ quality: 70 })
      .toBuffer();
    bases.push({ jpeg, thumb: jpeg });
  }

  const started = Date.now();
  const epoch = Date.now() - COUNT * 60_000;
  const BATCH = 500;
  for (let offset = 0; offset < COUNT; offset += BATCH) {
    const rows = [];
    for (let i = offset; i < Math.min(COUNT, offset + BATCH); i++) {
      const { jpeg, thumb } = bases[i % bases.length];
      const bytes = Buffer.concat([jpeg, randomBytes(16)]);
      const id = crypto.randomUUID();
      const key = storageKeys.original(id, 'jpg');
      await store.putStream(key, Readable.from(bytes), { contentType: 'image/jpeg', size: bytes.length });
      await store.putStream(storageKeys.thumbnail(id, 1), Readable.from(thumb), { contentType: 'image/jpeg', size: thumb.length });
      rows.push({
        id,
        filename: `${id}.jpg`,
        originalName: `IMG_${String(i + 1).padStart(5, '0')}.JPG`,
        mimeType: 'image/jpeg',
        size: BigInt(bytes.length),
        md5Checksum: createHash('md5').update(bytes).digest('hex'),
        storageKey: key,
        thumbVersion: 1,
        status: 'ready' as const,
        folderId: section.id,
        projectId: project.id,
        uploadedById: owner.id,
        createdAt: new Date(epoch + i * 60_000),
      });
    }
    await prisma.mediaFile.createMany({ data: rows });
    process.stdout.write(`\r${Math.min(COUNT, offset + BATCH)} / ${COUNT} files`);
  }
  console.log(`\nSeeded ${COUNT} files in ${Math.round((Date.now() - started) / 1000)} s: project ${project.id}, Section ${section.id}`);
  await disconnectPrisma();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
