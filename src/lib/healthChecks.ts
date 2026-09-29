/**
 * Reachability checks shared by `/api/health` and the status page: the
 * database, the cache (Dragonfly) and the local storage root. Each check has
 * a short timeout and answers false instead of throwing.
 */
import { constants as fsConstants, promises as fs } from 'fs';
import prisma from './prisma';
import { storageRoot } from './storageRoot';

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

/** The local storage root is readable and writable (Epic 4 replaces this with the storage backend). */
export async function storageUp(): Promise<boolean> {
  try {
    await fs.access(storageRoot(), fsConstants.R_OK | fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}
