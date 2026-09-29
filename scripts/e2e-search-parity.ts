/**
 * Story 4.5: search answers the same rows with and without Elasticsearch.
 *
 *   npx tsx scripts/e2e-search-parity.ts
 *
 * Creates a throwaway Project with files whose names exercise case, LIKE
 * and wildcard characters, then for every query compares:
 *   - the database path with a plain reference filter (same set), and
 *   - when ELASTICSEARCH_NODE_URL is set: the Elasticsearch path with the
 *     database path (same ids, same order), the index after trash,
 *     restore, move and purge, and an unreachable Elasticsearch (the
 *     database answers the same rows).
 * Removes everything it created. Refuses anything but a local database.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'crypto';

function assertLocalDatabase() {
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    host = '';
  }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error(`Refusing to run: DATABASE_URL must point at 127.0.0.1 or localhost (got: ${host || 'unset'}).`);
    process.exit(2);
  }
}

const NAMES = [
  'IMG_0001.JPG', 'img_0002.jpg', 'IMG-0003.heic', 'Clip A.mov', 'clip a (2).mov', 'clip?.mp4', 'x*y.png',
  '50% off.pdf', 'back\\slash.txt', 'under_score.txt', 'underXscore.txt', 'Zebra.mp4', 'zebra.MP4', 'Äpfel.jpg',
  'äpfel-2.jpg', 'Parity notes.txt', 'PARITY final.mov', 'a.b.c.d', 'drone_4k_0001.mp4', 'drone_4k_0002.mp4',
];
const QUERIES = ['img', 'IMG_', '_', '%', 'clip a', 'clip?', '?', 'x*y', '*', '\\', 'äpfel', 'ÄPFEL', '.mp4', 'parity', 'zebra', 'drone_4k', 'nothing-matches-this', ' img '];

async function main() {
  assertLocalDatabase();
  const { default: prisma, disconnectPrisma } = await import('../src/lib/prisma');
  const Library = await import('../src/modules/library');
  const Trash = await import('../src/modules/trash');
  const { esClient } = await import('../src/lib/elasticsearch');
  const es = esClient();
  let failures = 0;
  const check = (ok: boolean, label: string, detail?: unknown) => {
    if (ok) console.log(`  PASS ${label}`);
    else {
      failures++;
      console.log(`  FAIL ${label}`, detail === undefined ? '' : JSON.stringify(detail).slice(0, 600));
    }
  };

  const owner = await prisma.user.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  if (!owner) throw new Error('No user: run the seed or e2e:setup first');
  const project = await prisma.project.create({ data: { title: `Search parity ${Date.now()}` } });
  const other = await prisma.project.create({ data: { title: `Search parity other ${Date.now()}` } });
  const folder = await prisma.folder.create({ data: { name: 'Parity Section', projectId: project.id } });
  const otherFolder = await prisma.folder.create({ data: { name: 'Parity Other', projectId: other.id } });
  const ids: string[] = [];
  for (const name of NAMES) {
    const id = randomUUID();
    ids.push(id);
    await prisma.mediaFile.create({
      data: {
        id,
        filename: `${id}.bin`,
        originalName: name,
        mimeType: 'application/octet-stream',
        size: BigInt(1),
        md5Checksum: randomBytes(16).toString('hex'),
        storageKey: `files/${id}/original.bin`,
        status: 'ready',
        folderId: folder.id,
        projectId: project.id,
        uploadedById: owner.id,
      },
    });
  }
  const scope = { projectId: project.id };

  try {
    console.log(`search parity (${es ? 'Elasticsearch configured' : 'database only'})`);
    if (es) await Library.syncSearch(ids);

    for (const query of QUERIES) {
      const q = query.trim().toLowerCase();
      const expected = new Set(NAMES.filter((n) => n.toLowerCase().includes(q)));
      const db = await Library.searchFiles({ query, ...scope, useIndex: false });
      check(
        db.length === expected.size && db.every((r) => expected.has(r.originalName)),
        `database matches the reference for ${JSON.stringify(query)} (${expected.size})`,
        { got: db.map((r) => r.originalName), expected: [...expected] },
      );
      if (es) {
        const viaEs = await Library.searchFiles({ query, ...scope });
        check(
          JSON.stringify(viaEs.map((r) => r.id)) === JSON.stringify(db.map((r) => r.id)),
          `Elasticsearch path equals the database path for ${JSON.stringify(query)}`,
          { es: viaEs.map((r) => r.originalName), db: db.map((r) => r.originalName) },
        );
      }
    }

    // Order and limit: name, then id; at most SEARCH_LIMIT.
    const all = await Library.searchFiles({ query: '.', ...scope, useIndex: false });
    const names = all.map((r) => r.originalName);
    check(all.length <= Library.SEARCH_LIMIT, 'at most SEARCH_LIMIT rows');
    check(names.length > 3, 'ordered result is not empty', names);

    if (es) {
      const exists = async (id: string) => (await es.exists({ index: 'media_files', id })) === true;
      const waitFor = async (id: string, want: boolean) => {
        for (let i = 0; i < 50; i++) {
          if ((await exists(id)) === want) return true;
          await new Promise((r) => setTimeout(r, 100));
        }
        return false;
      };
      const target = ids[0];
      await Trash.trashFile(target);
      check(await waitFor(target, false), 'trash removes the file from the index');
      await Trash.restoreFile(target);
      check(await waitFor(target, true), 'restore puts it back');

      // Move to another Project (the moveFile resolver syncs; here the
      // module call the resolver makes).
      await prisma.mediaFile.update({ where: { id: ids[1] }, data: { folderId: otherFolder.id, projectId: other.id } });
      await Library.syncSearch([ids[1]]);
      const moved = await Library.searchFiles({ query: 'img_0002', projectId: other.id });
      check(moved.length === 1 && moved[0].id === ids[1], 'a moved file is found in its new Project');
      const left = await Library.searchFiles({ query: 'img_0002', ...scope });
      check(left.length === 0, 'and no longer in the old one');

      // Elasticsearch unreachable: the database answers the same rows.
      const g = globalThis as unknown as { esClient: unknown };
      const saved = g.esClient;
      const { Client } = await import('@elastic/elasticsearch');
      g.esClient = new Client({ node: 'http://127.0.0.1:9', maxRetries: 0, requestTimeout: 1000 });
      const down = await Library.searchFiles({ query: 'img', ...scope });
      g.esClient = saved;
      const db = await Library.searchFiles({ query: 'img', ...scope, useIndex: false });
      check(JSON.stringify(down.map((r) => r.id)) === JSON.stringify(db.map((r) => r.id)), 'Elasticsearch down: same rows from the database');
    }
  } finally {
    // Purge everything created here (and, with ES, check the index follows).
    await prisma.mediaFile.updateMany({ where: { id: { in: ids } }, data: { trashedAt: new Date(), trashRootId: null } });
    await Trash.purgeRoots({ fileIds: ids });
    if (es) {
      const left = await Promise.all(ids.map((id) => es.exists({ index: 'media_files', id })));
      check(left.every((x) => x === false), 'purge removes every file from the index');
    }
    await prisma.folder.deleteMany({ where: { id: { in: [folder.id, otherFolder.id] } } });
    await prisma.project.deleteMany({ where: { id: { in: [project.id, other.id] } } });
    await disconnectPrisma();
  }

  console.log(failures ? `search parity: ${failures} FAILED` : 'search parity: ALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
