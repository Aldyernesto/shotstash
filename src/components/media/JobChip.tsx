"use client";

/**
 * Story 5.4: a pipeline job on a `status-chip` (viewer, cards, list rows).
 * Words and tones come from `jobChip()` (src/lib/jobChip.ts); the label is
 * always written, the dot stays decorative. With `announce`, a polite
 * `role="status"` region tells the stage (queued, processing, ready,
 * failed, cancelled), never every percent.
 */
import React from "react";
import { useTranslations } from "next-intl";
import { StatusChip } from "@/components/form/StatusChip";
import { jobChip, type JobLike } from "@/lib/jobChip";

export type JobChipProps = {
  job: (JobLike & { error?: string | null }) | null | undefined;
  /** Kind label for the announcement ("Proxy (720p)"). */
  kindLabel?: string;
  announce?: boolean;
  /** On the always-dark viewer layer. */
  onDark?: boolean;
  className?: string;
};

/** The written label of a job chip ("Processing 42%"). */
export function useJobStateLabel() {
  const t = useTranslations("jobs.state");
  return (job: JobLike | null | undefined): string | null => {
    const chip = jobChip(job);
    if (!chip) return null;
    return chip.labelKey === "running" ? t("running", { progress: chip.progress ?? 0 }) : t(chip.labelKey);
  };
}

export function JobChip({ job, kindLabel, announce = false, onDark = false, className }: JobChipProps) {
  const t = useTranslations("jobs");
  const label = useJobStateLabel();
  const chip = jobChip(job);
  if (!chip || !job) return null;
  return (
    <>
      <StatusChip tone={chip.tone} onDark={onDark} className={className} title={chip.labelKey === "failed" && job.error ? job.error : undefined}>
        {label(job)}
      </StatusChip>
      {announce ? (
        <span role="status" className="spine-visually-hidden">
          {t("announce", { kind: kindLabel ?? "", stage: chip.stage })}
        </span>
      ) : null}
    </>
  );
}
