/**
 * Regenerates thumbnails of existing files (Story 4.4): 480 px on the long
 * edge, source aspect ratio, orientation applied. Each file gets a new
 * thumbnail version (the old key is deleted after the row points at the new
 * one), so browsers holding the old URL fetch the new image. HEIC files are
 * rendered from their preview version.
 *
 * An operator task: it runs with the server's own configuration (database
 * and storage) from a checkout or inside the app container, never from a
 * browser.
 *
 *   npm run thumbs:rebuild                 every photo and video
 *   npm run thumbs:rebuild -- --missing    only files without a thumbnail
 */
import 'dotenv/config';
import prisma, { disconnectPrisma } from '../src/lib/prisma';
import { generateThumbnail, isHeicMime, needsThumbnail, previewOf } from '../src/modules/media';
import { storage, storageKeys } from '../src/modules/storage';

async function readAll(key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of await storage().getStream(key)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function main() {
  const onlyMissing = process.argv.includes('--missing');
  let cursor: string | undefined;
  let done = 0;
  let failed = 0;
  for (;;) {
    const rows = await prisma.mediaFile.findMany({
      where: { status: 'ready', ...(onlyMissing ? { thumbVersion: 0 } : {}) },
      select: { id: true, storageKey: true, mimeType: true, thumbVersion: true, processedVersions: true },
      orderBy: { id: 'asc' },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    for (const f of rows) {
      if (!needsThumbnail(f.mimeType)) continue;
      let from: Buffer | undefined;
      if (isHeicMime(f.mimeType)) {
        const preview = previewOf(f.processedVersions);
        if (!preview) continue;
        from = await readAll(preview.storageKey).catch(() => undefined);
        if (!from) continue;
      }
      const version = await generateThumbnail(f, { from });
      if (!version) {
        failed++;
        continue;
      }
      await prisma.mediaFile.update({ where: { id: f.id }, data: { thumbVersion: version } });
      if (f.thumbVersion) await storage().delete(storageKeys.thumbnail(f.id, f.thumbVersion)).catch(() => {});
      done++;
      if (done % 100 === 0) console.log(`${done} thumbnails rebuilt`);
    }
  }
  console.log(JSON.stringify({ rebuilt: done, failed }));
  await disconnectPrisma();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
