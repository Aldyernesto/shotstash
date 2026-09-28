/*
 * Demo data for a public demo instance (Story 2.6).
 *
 *   SHOTSTASH_DEMO_MODE=true DEMO_ADMIN_PASSWORD=... npm run demo:seed
 *
 * Rules:
 *   - runs only with SHOTSTASH_DEMO_MODE=true and a DEMO_ADMIN_PASSWORD of at
 *     least 10 characters (exit code 2 otherwise);
 *   - runs only after first-run setup is complete (the owner created the
 *     super admin through /setup); it never writes instance_settings;
 *   - every demo account is read-only (`read_only = true`): it can browse,
 *     never write;
 *   - an existing account with a demo address is left alone (with a
 *     warning) unless it already is a read-only demo account; super admin
 *     accounts are never touched;
 *   - idempotent: re-running replaces exactly what it created. The nightly
 *     reset of a demo instance is not part of this script.
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';

const MIN_PASSWORD_LENGTH = 10;

const DEMO_USERS = [
  { email: 'demo-admin@example.com', name: 'Demo Admin', role: 'ADMIN' },
  { email: 'demo-editor@example.com', name: 'Demo Editor', role: 'EDITOR' },
  { email: 'demo-viewer@example.com', name: 'Demo Viewer', role: 'VIEWER' },
] as const;

/** Fixed ids so re-running replaces exactly what this script created. */
const DEMO_PROJECT_ID = 'd0000000-0000-4000-8000-000000000001';

function fail(message: string): never {
  console.error(`[demo:seed] ${message}`);
  process.exit(2);
}

async function main() {
  if (process.env.SHOTSTASH_DEMO_MODE !== 'true') fail('Refusing to run: set SHOTSTASH_DEMO_MODE=true.');
  const password = process.env.DEMO_ADMIN_PASSWORD ?? '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Refusing to run: DEMO_ADMIN_PASSWORD must have at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const { default: prisma } = await import('../src/lib/prisma');
  const setup = await prisma.instanceSetting.findUnique({ where: { id: 1 } });
  if (!setup) {
    await prisma.$disconnect();
    fail('Refusing to run: complete first-run setup at /setup first.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  for (const u of DEMO_USERS) {
    const data = {
      name: u.name,
      role: u.role,
      passwordHash,
      active: true,
      accountStatus: 'ACTIVE' as const,
      onboardedAt: now,
      readOnly: true,
    };
    const existing = await prisma.user.findUnique({ where: { email: u.email }, select: { role: true, readOnly: true } });
    // Never take over a real account that happens to use a demo address.
    if (existing && (existing.role === 'SUPER_ADMIN' || !existing.readOnly)) {
      console.warn(`[demo:seed] skipped ${u.email}: an existing account uses it and is not a read-only demo account`);
      continue;
    }
    await prisma.user.upsert({ where: { email: u.email }, update: data, create: { email: u.email, ...data } });
  }

  // Links into the demo project go first (share_links_exactly_one_target CHECK).
  await prisma.shareLink.deleteMany({
    where: {
      OR: [
        { projectId2: DEMO_PROJECT_ID },
        { folder: { projectId: DEMO_PROJECT_ID } },
        { file: { projectId: DEMO_PROJECT_ID } },
      ],
    },
  });
  await prisma.project.deleteMany({ where: { id: DEMO_PROJECT_ID } });
  const project = await prisma.project.create({
    data: {
      id: DEMO_PROJECT_ID,
      title: 'Demo project',
      description: 'Sample project of the demo instance. Demo accounts are read-only.',
    },
  });
  for (const name of ['01 Footage', '02 Photos', '03 Documents']) {
    await prisma.folder.create({ data: { name, projectId: project.id } });
  }

  console.log('[demo:seed] done; read-only accounts:');
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(7)} ${u.email}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[demo:seed] failed:', (e as Error)?.message);
  process.exit(1);
});
