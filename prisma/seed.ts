/*
 * Local development seed for Shotstash.
 *
 * Safety gates (exit code 2): the script refuses to run when
 * NODE_ENV=production, and unless the DATABASE_URL host is 127.0.0.1 or
 * localhost, so it can never touch a shared or production database by
 * accident.
 *
 * What it creates (idempotent, safe to re-run):
 *   - one account per role, all with the same development password
 *   - one sample project with one empty section
 *   - the setup-complete marker (instance_settings), since accounts exist
 *
 * Usage (from the repo root):
 *   npm run dev:db      # terminal 1: embedded PGlite on port 55433
 *   npm run dev:seed    # terminal 2: prisma db push + this script
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';

function assertNotProduction() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV=production. Production installs start with the /setup wizard.');
    process.exit(2);
  }
}

function assertLocalDatabase() {
  const raw = process.env.DATABASE_URL;
  let host = '';
  try { host = raw ? new URL(raw).hostname : ''; } catch { host = ''; }
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error(`Refusing to seed: DATABASE_URL must point at 127.0.0.1 or localhost (got: ${host || 'unset or invalid'}).`);
    process.exit(2);
  }
}

/** Password for every development account. Override with SEED_PASSWORD. */
const DEV_PASSWORD = process.env.SEED_PASSWORD || 'shotstash-dev';

const DEV_USERS = [
  { email: 'superadmin@example.com', name: 'Super Admin', role: 'SUPER_ADMIN' },
  { email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
  { email: 'crew@example.com', name: 'Field Crew', role: 'FIELD_CREW' },
  { email: 'editor@example.com', name: 'Editor', role: 'EDITOR' },
  { email: 'viewer@example.com', name: 'Viewer', role: 'VIEWER' },
] as const;

/** Fixed id so re-running the seed replaces exactly what it created. */
const SAMPLE_PROJECT_ID = 'a0000000-0000-4000-8000-000000000001';

async function main() {
  assertNotProduction();
  assertLocalDatabase();
  const { default: prisma } = await import('../src/lib/prisma');

  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  const now = new Date();
  for (const u of DEV_USERS) {
    const data = {
      name: u.name,
      role: u.role,
      passwordHash,
      active: true,
      accountStatus: 'ACTIVE' as const,
      onboardedAt: now,
    };
    await prisma.user.upsert({
      where: { email: u.email },
      update: data,
      create: { email: u.email, ...data },
    });
  }

  // Links into the sample project go first (share_links_exactly_one_target CHECK).
  await prisma.shareLink.deleteMany({
    where: {
      OR: [
        { projectId2: SAMPLE_PROJECT_ID },
        { folder: { projectId: SAMPLE_PROJECT_ID } },
        { file: { projectId: SAMPLE_PROJECT_ID } },
      ],
    },
  });
  await prisma.project.deleteMany({ where: { id: SAMPLE_PROJECT_ID } });
  const project = await prisma.project.create({
    data: {
      id: SAMPLE_PROJECT_ID,
      title: 'Sample project',
      description: 'A place to try uploads, sections and share links.',
    },
  });
  await prisma.folder.create({ data: { name: 'Footage', projectId: project.id } });

  // The seed creates accounts, so first-run setup is done.
  await prisma.instanceSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, setupCompletedAt: now },
  });

  // Like first-run setup: probe the storage backend, which marks a local
  // root as the storage root (.shotstash-storage, see docs/storage.md).
  const { storage } = await import('../src/modules/storage');
  const probe = await storage().probe('write');
  if (!probe.ok) console.warn(`[seed] storage probe failed: ${probe.reason}`);

  console.log('[seed] done');
  console.log(`[seed] password for every account: ${DEV_PASSWORD}`);
  for (const u of DEV_USERS) console.log(`  ${u.role.padEnd(11)} ${u.email}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});
