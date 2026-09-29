/**
 * Runs the upload-session sweeper once (Story 4.3): sessions older than
 * 24 h are aborted on the storage backend, their parts and `uploading`
 * rows removed, and marked EXPIRED. The server does this hourly; this is
 * for development and the e2e checks.
 *
 *   npx tsx scripts/sweep-uploads.ts
 */
import 'dotenv/config';
import { expireSessions } from '../src/modules/upload';
import { disconnectPrisma } from '../src/lib/prisma';

async function main() {
  const expired = await expireSessions(new Date());
  console.log(JSON.stringify({ expired }));
  await disconnectPrisma();
  // Dragonfly connections opened by imported modules would keep the process alive.
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
