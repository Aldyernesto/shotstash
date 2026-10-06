/**
 * Story 8.2: demo seed and reset from the command line. Compiled to
 * `dist/demo.js` by `scripts/build-demo.mjs`, so it runs inside the image,
 * as the app user (root would leave media files the app cannot manage):
 *
 *   docker compose exec -u node app node dist/demo.js seed
 *   docker compose exec -u node app node dist/demo.js reset
 *
 * From source: `npm run demo:seed` and `npm run demo:reset`. Runs under the
 * same Dragonfly lock as the nightly reset. Exit codes: 0 done, 1 failed,
 * 2 refused (demo mode off, short password, setup missing, root on local
 * storage, another seed or reset running, unknown command).
 */
import 'dotenv/config';
import { config, configProblems } from '@/lib/config';
import { closeDragonfly, dfClient, withLock } from '@/lib/dragonfly';
import { disconnectPrisma } from '@/lib/prisma';
import { DEMO_ACCOUNTS } from '@/lib/demoAccounts';
import { DEMO_LOCK, DEMO_LOCK_TTL_MS, DemoError, resetDemo, seedDemo } from './index.ts';

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
  if (process.getuid?.() === 0 && config().STORAGE_BACKEND === 'local') {
    console.error(`[demo] Refusing to run as root on local storage: run with \`docker compose exec -u node app node dist/demo.js ${command}\`.`);
    return 2;
  }
  try {
    const started = Date.now();
    // Give the lock store a moment to connect (it is lazy).
    const client = dfClient();
    for (let i = 0; i < 30 && client.status !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100));
    const run = () => (command === 'seed' ? seedDemo() : resetDemo());
    const locked = await withLock(DEMO_LOCK, DEMO_LOCK_TTL_MS, run);
    let result;
    if (locked.ran) result = locked.value;
    else if (locked.reason === 'held') {
      console.error('[demo] Refusing to run: another seed or reset is running.');
      return 2;
    } else {
      console.warn('[demo] no lock store (Dragonfly unavailable): running without the lock');
      result = await run();
    }
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
