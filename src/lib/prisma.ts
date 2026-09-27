// Shotstash — Prisma Client Singleton
// Layer 4: Data Access

import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const getPrismaClient = () => {
  // PGlite (database dev di port 55433) menutup koneksi saat banyak kueri
  // datang bersamaan — dashboard menembakkan puluhan agregat sekaligus dan
  // memunculkan "Server has closed the connection." Batasi kolam koneksi ke 1
  // HANYA untuk database dev lokal; produksi (Postgres sungguhan) tidak diubah.
  const isDevPglite = !!connectionString && connectionString.includes(':55433');
  const pool = new Pool(
    isDevPglite
      ? { connectionString, max: 1, idleTimeoutMillis: 0, keepAlive: true }
      : { connectionString },
  );
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

export const prisma =
  globalForPrisma.prisma ?? getPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
