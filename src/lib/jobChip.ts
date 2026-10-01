/**
 * Story 5.4: how a pipeline job reads on a `status-chip` (viewer, cards and
 * list rows). One mapping, so every place shows the same words and tones:
 *
 *   queued              neutral  "Queued"
 *   waiting_for_worker  warning  "Waiting for worker"
 *   claimed             accent   "Starting"
 *   running             accent   "Processing 42%"
 *   done                ok       "Ready"
 *   failed              danger   "Failed" (Retry)
 *   cancelled           neutral  "Cancelled"
 *
 * `labelKey` is a key under the `jobs.state` messages; `stage` is what a
 * screen reader hears (per stage, never per percent).
 *
 * Pure and alias-free: `node --test` imports it directly.
 */

export type JobChipTone = "neutral" | "warning" | "accent" | "ok" | "danger";

export type JobLike = { state: string; progress?: number | null };

export type JobChip = {
  tone: JobChipTone;
  labelKey: "queued" | "waiting_for_worker" | "claimed" | "running" | "done" | "failed" | "cancelled";
  /** Percent for `running` (0 to 100), else null. */
  progress: number | null;
  /** Announced stage: queued (queued, waiting, starting), running, ready, failed, cancelled. */
  stage: "queued" | "running" | "ready" | "failed" | "cancelled";
  /** Unfinished: may be cancelled. */
  open: boolean;
  /** Failed: may be queued again. */
  retry: boolean;
  /** Done or cancelled: cards and list rows show nothing. */
  finished: boolean;
};

const TABLE: Record<string, Omit<JobChip, "progress">> = {
  queued: { tone: "neutral", labelKey: "queued", stage: "queued", open: true, retry: false, finished: false },
  waiting_for_worker: { tone: "warning", labelKey: "waiting_for_worker", stage: "queued", open: true, retry: false, finished: false },
  claimed: { tone: "accent", labelKey: "claimed", stage: "queued", open: true, retry: false, finished: false },
  running: { tone: "accent", labelKey: "running", stage: "running", open: true, retry: false, finished: false },
  done: { tone: "ok", labelKey: "done", stage: "ready", open: false, retry: false, finished: true },
  failed: { tone: "danger", labelKey: "failed", stage: "failed", open: false, retry: true, finished: false },
  cancelled: { tone: "neutral", labelKey: "cancelled", stage: "cancelled", open: false, retry: false, finished: true },
};

/** The chip of a job; null for an unknown state. */
export function jobChip(job: JobLike | null | undefined): JobChip | null {
  if (!job) return null;
  const row = TABLE[job.state];
  if (!row) return null;
  const pct = Number(job.progress);
  const progress = row.labelKey === "running" ? Math.max(0, Math.min(100, Number.isFinite(pct) ? Math.floor(pct) : 0)) : null;
  return { ...row, progress };
}

/** Whether a card or list row shows this job (unfinished or failed; done and cancelled live in the viewer). */
export function showsOnCard(job: JobLike | null | undefined): boolean {
  const chip = jobChip(job);
  return !!chip && !chip.finished;
}

type Versioned = { id: string; seq: number; updatedAt?: string | number | Date | null };

function timeOf(v: Versioned["updatedAt"]): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The newer of two views of a file's job: the same job compares by `seq`,
 * different jobs by `updatedAt` (a job queued after another is newer).
 */
export function newerJob<T extends Versioned>(a: T | null | undefined, b: T | null | undefined): T | null {
  if (!a) return b ?? null;
  if (!b) return a;
  if (a.id === b.id) return b.seq > a.seq ? b : a;
  return timeOf(b.updatedAt) > timeOf(a.updatedAt) ? b : a;
}
