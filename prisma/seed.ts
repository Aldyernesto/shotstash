/*
 * Local development seed for Shotstash.
 *
 * Safety gate: the script refuses to run unless the DATABASE_URL host is
 * 127.0.0.1 or localhost (exit code 2), so it can never touch a shared or
 * production database by accident.
 *
 * What it creates (idempotent, safe to re-run):
 *   - one account per role, all with the same development password
 *   - one sample project with one empty section
 *
 * Usage (from the repo root):
 *   npm run dev:db      # terminal 1: embedded PGlite on port 55433
 *   npm run dev:seed    # terminal 2: prisma db push + this script
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';

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

  await prisma.project.deleteMany({ where: { id: SAMPLE_PROJECT_ID } });
  const project = await prisma.project.create({
    data: {
      id: SAMPLE_PROJECT_ID,
      title: 'Sample project',
      description: 'A place to try uploads, sections and share links.',
    },
  });
  await prisma.folder.create({ data: { name: 'Footage', projectId: project.id } });

  console.log('[seed] done');
  console.log(`[seed] password for every account: ${DEV_PASSWORD}`);
  for (const u of DEV_USERS) console.log(`  ${u.role.padEnd(11)} ${u.email}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[seed] failed:', e);
  process.exit(1);
});
