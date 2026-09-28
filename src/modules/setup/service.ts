/**
 * First-run setup (Story 2.6).
 *
 * `instance_settings` is a singleton (CHECK id = 1). Completing setup inserts
 * that row with `ON CONFLICT DO NOTHING RETURNING` and creates the super admin
 * in the same transaction, so of two concurrent submissions exactly one wins;
 * the other gets `SETUP_ALREADY_DONE` and nothing is written.
 */
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import * as bcrypt from 'bcryptjs';
import prisma from '@/lib/prisma';
import { storageRoot } from '@/lib/storageRoot';
import { isSetupComplete, markSetupComplete } from '@/lib/setupState';
import type { SetupInput } from './validate';

export { isSetupComplete };

export class SetupError extends Error {
  constructor(
    public code: 'SETUP_ALREADY_DONE' | 'STORAGE_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'SetupError';
  }
}

export type StorageProbe = { ok: true } | { ok: false; reason: string };

/** Writes, reads back and deletes a probe file under the storage root. */
export async function probeStorage(): Promise<StorageProbe> {
  const root = storageRoot();
  const probe = path.join(root, `.shotstash-probe-${randomBytes(8).toString('hex')}`);
  const payload = randomBytes(16).toString('hex');
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(probe, payload, { flag: 'wx' });
    const back = await fs.readFile(probe, 'utf8');
    if (back !== payload) return { ok: false, reason: 'Storage returned different bytes than were written.' };
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    return { ok: false, reason: code ? `Storage is not writable (${code}).` : 'Storage is not writable.' };
  } finally {
    await fs.unlink(probe).catch(() => {});
  }
}

/**
 * Creates the first super admin and marks setup complete, atomically.
 * Throws `SetupError('SETUP_ALREADY_DONE')` when setup already happened
 * (or an account already exists), `SetupError('STORAGE_UNAVAILABLE')` when
 * the storage probe fails (nothing is created then).
 */
export async function completeSetup(input: SetupInput) {
  if (await isSetupComplete()) throw new SetupError('SETUP_ALREADY_DONE', 'Setup is already complete');

  const probe = await probeStorage();
  if (!probe.ok) throw new SetupError('STORAGE_UNAVAILABLE', probe.reason);

  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await prisma.$transaction(async (tx) => {
    const won = await tx.$queryRaw<{ id: number }[]>`
      INSERT INTO "instance_settings" ("id", "setup_completed_at")
      VALUES (1, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING
      RETURNING "id"`;
    if (won.length !== 1) throw new SetupError('SETUP_ALREADY_DONE', 'Setup is already complete');
    // Accounts already exist but the settings row is missing (a restored
    // database): keep the row just inserted (backfill) so the gate opens,
    // and create no second owner.
    if ((await tx.user.count()) > 0) return { backfilled: true as const };
    const now = new Date();
    const user = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: 'SUPER_ADMIN',
        active: true,
        accountStatus: 'ACTIVE',
        onboardedAt: now,
        approvedAt: now,
      },
      select: { id: true, email: true, name: true },
    });
    return { backfilled: false as const, user };
  });
  markSetupComplete();
  if (result.backfilled) throw new SetupError('SETUP_ALREADY_DONE', 'Accounts already exist');
  return result.user;
}
