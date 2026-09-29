/**
 * Rebuilds the Elasticsearch file index from the database (Story 4.5).
 * Needs ELASTICSEARCH_NODE_URL; the running app keeps the index in step on
 * its own afterwards (ready, move, trash, restore, purge).
 *
 *   npm run search:reindex
 */
import 'dotenv/config';
import { reindexSearch } from '../src/modules/library';
import { disconnectPrisma } from '../src/lib/prisma';

async function main() {
  const count = await reindexSearch();
  console.log(JSON.stringify({ indexed: count }));
  await disconnectPrisma();
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
