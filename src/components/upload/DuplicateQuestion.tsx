"use client";

/**
 * Story 4.3: duplicate question. It REPLACES the
 * content of `upload-panel` (one modal layer, no dialog over a dialog).
 * "Skip" is the default (accent, first); "Upload anyway" keeps both files.
 * With more duplicates waiting, one checkbox applies the answer to all.
 */

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButton } from "@/components/form/buttons";
import type { DuplicatePrompt } from "@/components/UploadContext";
import styles from "./upload.module.css";

const COPY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
);

export function DuplicateBody({
  prompt,
  titleId,
  applyAll,
  onApplyAll,
}: {
  prompt: DuplicatePrompt;
  titleId: string;
  applyAll: boolean;
  onApplyAll: (v: boolean) => void;
}) {
  const t = useTranslations("upload.duplicate");
  const ref = useRef<HTMLParagraphElement>(null);

  // Focus moves to the question when the panel content changes.
  useEffect(() => {
    ref.current?.focus();
  }, [prompt.taskId]);

  return (
    <>
      <div className={styles.dupeCard} aria-hidden="true">
        <span className={styles.dupeIcon}>{COPY}</span>
        <span className={`spine-body-sm ${styles.dupeName}`}>{prompt.name}</span>
      </div>
      <p id={titleId} ref={ref} tabIndex={-1} className="spine-body">
        {prompt.name === prompt.existingName
          ? t.rich("bodySame", { name: prompt.name, b: (chunks) => <b>{chunks}</b> })
          : t.rich("body", { name: prompt.name, existing: prompt.existingName, b: (chunks) => <b>{chunks}</b> })}
      </p>
      <p className={`spine-footnote ${styles.questionNote}`}>{t("note")}</p>
      {prompt.remaining > 0 ? (
        <label className={`spine-body-sm ${styles.dupeAll}`}>
          <input type="checkbox" checked={applyAll} onChange={(e) => onApplyAll(e.target.checked)} />
          {t("applyAll", { count: prompt.remaining })}
        </label>
      ) : null}
    </>
  );
}

export function DuplicateActions({ onSkip, onUpload }: { onSkip: () => void; onUpload: () => void }) {
  const t = useTranslations("upload.duplicate");
  return (
    <div className={styles.questionActions}>
      <PillButton variant="accent" onClick={onSkip}>
        {t("skip")}
      </PillButton>
      <PillButton variant="surface" onClick={onUpload}>
        {t("uploadAnyway")}
      </PillButton>
    </div>
  );
}

/** Local state for the "apply to all" checkbox, reset for each question. */
export function useApplyAll(prompt: DuplicatePrompt | null) {
  const [applyAll, setApplyAll] = useState(false);
  const [forTask, setForTask] = useState<string | null>(null);
  if (prompt && prompt.taskId !== forTask) {
    setForTask(prompt.taskId);
    setApplyAll(false);
  }
  return [applyAll, setApplyAll] as const;
}
