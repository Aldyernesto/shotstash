// Shotstash — Prisma Client Singleton
// Layer 4: Data Access

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './config';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const getPrismaClient = () => {
  const connectionString = config().DATABASE_URL;
  // The PGlite dev database (port 55433) closes connections when many
  // queries arrive at once (the dashboard fires dozens of aggregates),
  // which surfaces as "Server has closed the connection." Limit the pool to
  // one connection for that local dev database ONLY; a real PostgreSQL is
  // left as is.
  const isDevPglite = !!connectionString && connectionString.includes(':55433');
  const pool = new Pool(
    isDevPglite
      ? { connectionString, max: 1, idleTimeoutMillis: 0, keepAlive: true }
      : { connectionString },
  );
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

/** The one client per process, created on first use (never at import, so `next build` reads no configuration). */
function client(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = getPrismaClient();
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = client();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export default prisma;

/** Shutdown: closes the client when one was created (never creates one). */
export async function disconnectPrisma(): Promise<void> {
  await globalForPrisma.prisma?.$disconnect();
}
