/**
 * Upload part size, decided by the server (Story 4.3).
 *
 * 16 MiB, raised to the next whole MiB at or above `ceil(size / 10000)` for
 * very large files, so no upload needs more than 10,000 parts (the S3
 * limit). Every part except the last has the same size (an R2 rule); the
 * last part holds the remainder. An empty file is one empty part.
 *
 * Pure and alias-free.
 */
export const MIB = 1024 * 1024;
export const DEFAULT_PART_SIZE = 16 * MIB;
export const MAX_PARTS = 10_000;

export type PartPlan = { partSize: number; partCount: number };

export function partPlan(size: number): PartPlan {
  if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('size must be a non-negative integer');
  let partSize = DEFAULT_PART_SIZE;
  const minimum = Math.ceil(size / MAX_PARTS);
  if (minimum > partSize) partSize = Math.ceil(minimum / MIB) * MIB;
  const partCount = Math.max(1, Math.ceil(size / partSize));
  return { partSize, partCount };
}

/** Expected byte length of part `partNumber` (1-based) of a file of `size` bytes. */
export function expectedPartSize(plan: PartPlan & { size: number }, partNumber: number): number {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > plan.partCount) return -1;
  if (partNumber < plan.partCount) return plan.partSize;
  return plan.size - plan.partSize * (plan.partCount - 1);
}
