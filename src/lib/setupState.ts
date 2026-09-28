/**
 * Setup gate state (Story 2.6). `instance_settings` holds one row once the
 * first super admin exists. The answer is cached in memory once true (setup
 * never becomes incomplete again); until then every call asks the database.
 *
 * Used by `server.ts` (pages, `/api`, `/media`) and `defineRoute()` (second
 * layer). Note that the custom server and the Next bundle are separate module
 * instances, so each keeps its own cache.
 */
import prisma from '@/lib/prisma';

let complete = false;

export async function isSetupComplete(): Promise<boolean> {
  if (complete) return true;
  const row = await prisma.instanceSetting.findUnique({ where: { id: 1 }, select: { id: true } });
  if (row) complete = true;
  return complete;
}

/** Called by the setup service right after it committed the singleton row. */
export function markSetupComplete() {
  complete = true;
}
