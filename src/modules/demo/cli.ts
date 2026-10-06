/**
 * Story 8.2: demo seed and reset from the command line. Compiled to
 * `dist/demo.js` by `scripts/build-demo.mjs`, so it runs inside the image:
 *
 *   docker compose exec app node dist/demo.js seed
 *   docker compose exec app node dist/demo.js reset
 *
 * From source: `npm run demo:seed` and `npm run demo:reset`.
 * Exit codes: 0 done, 1 failed, 2 refused (demo mode off, setup missing,
 * unknown command).
 */
import 'dotenv/config';
import { configProblems } from '@/lib/config';
import { closeDragonfly } from '@/lib/dragonfly';
import { disconnectPrisma } from '@/lib/prisma';
import { DEMO_ACCOUNTS } from '@/lib/demoAccounts';
import { DemoError, resetDemo, seedDemo } from './index.ts';

const USAGE = 'Usage: node dist/demo.js seed|reset';

async function main(): Promise<number> {
  const command = process.argv[2];
  if (command !== 'seed' && command !== 'reset') {
    console.error(USAGE);
    return 2;
  }
  const problems = configProblems();
  if (problems.length) {
    for (const p of problems) console.error(`config: ${p}`);
    return 2;
  }
  try {
    const started = Date.now();
    const result = command === 'seed' ? await seedDemo() : await resetDemo();
    console.log(`[demo] ${command} done in ${Math.round((Date.now() - started) / 1000)} s: ${result.files} files in project ${result.projectId}`);
    console.log('[demo] read-only accounts (password: DEMO_ADMIN_PASSWORD):');
    for (const a of DEMO_ACCOUNTS) {
      const note = result.skipped.includes(a.email) ? '  (skipped: the address belongs to another account)' : '';
      console.log(`  ${a.role.padEnd(7)} ${a.email}${note}`);
    }
    console.log(`[demo] public share link: /s/${result.shareSlug}`);
    return 0;
  } catch (err) {
    if (err instanceof DemoError) {
      console.error(`[demo] ${err.message}`);
      return 2;
    }
    console.error('[demo] failed:', (err as Error)?.message ?? err);
    return 1;
  }
}

main().then(async (code) => {
  await Promise.allSettled([disconnectPrisma(), closeDragonfly()]);
  process.exit(code);
});
