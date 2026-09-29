/**
 * Reachability checks shared by `/api/health` and the status page: the
 * database and the cache (Dragonfly). Storage is checked by the storage
 * module (`storageHealth`), which lib may not import. Each check has a short
 * timeout and answers false instead of throwing.
 */
import prisma from './prisma';

function timeout<T>(p: Promise<T>, ms = 1500): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

export async function dbUp(): Promise<boolean> {
  try {
    await timeout(prisma.$queryRaw`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

export async function cacheUp(): Promise<boolean> {
  try {
    const { dfClient } = await import('./dragonfly');
    const client = dfClient();
    if (client.status !== 'ready') return false;
    return (await timeout(client.ping(), 500)) === 'PONG';
  } catch {
    return false;
  }
}
