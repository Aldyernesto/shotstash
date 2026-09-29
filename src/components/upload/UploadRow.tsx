"use client";

/**
 * Story 3.13 — `upload-row`.
 *
 * Grid 40px / 1fr / auto, min-height 64px: 40px file-type tile with an accent
 * icon, one-line name, status meta, a 4px accent progress line, and slot aksi
 * kanan BERUKURAN TETAP.
 *
 * Keadaan SELALU tertulis sebagai teks, tidak pernah warna saja (NFR15).
 *
 * The fixed-width action slot on the right holds, per state: remove (waiting,
 * paused), percent (running), a check (done), "Retry" or "Upload anyway"
 * (failed), and "Choose file" for an unfinished upload from before a reload
 * (Story 4.3; mock key-upload 04).
 */

import React, { useRef } from "react";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/useFormat";
import { PillButton } from "@/components/form/buttons";
import type { UploadTask } from "./uploadTypes";
import { useUploadFailureText } from "./useUploadFailureText";
import styles from "./upload.module.css";

const ICON_PHOTO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="8.5" cy="10" r="1.6" />
    <path d="M4 17l5-5 4 4 2.5-2.5L20 17" />
  </svg>
);

const ICON_VIDEO = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="6" width="13" height="12" rx="2.5" />
    <path d="M16 10.5l5-2.5v8l-5-2.5z" />
  </svg>
);

const ICON_DOC = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

const ICON_X = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const ICON_CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const ICON_WARN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </svg>
);

function iconFor(name: string) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["mp4", "mov", "avi", "mkv", "m4v", "webm"].includes(ext)) return ICON_VIDEO;
  if (["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "raw", "cr2", "nef", "dng"].includes(ext)) {
    return ICON_PHOTO;
  }
  return ICON_DOC;
}

/** Status sentence: always text, never color alone. */
function statusSentence(task: UploadTask, t: ReturnType<typeof useTranslations<"upload.row">>): string {
  switch (task.status) {
    case "success":
      return t("statusDone");
    case "merging":
      return t("statusMerging");
    case "uploading":
      return task.retryIn
        ? t("statusRetrying", { progress: task.progress, seconds: task.retryIn })
        : t("statusUploading", { progress: task.progress });
    case "checking":
      return t("statusChecking", { progress: task.progress });
    case "skipped":
      return t("statusSkipped");
    case "paused":
      return t("statusPaused", { done: task.resume?.confirmed ?? 0, total: task.resume?.partCount ?? 0 });
    case "error":
      return t("statusFailed");
    default:
      return task.allowDuplicate ? t("statusWaitingDuplicate") : t("statusWaiting");
  }
}

export default function UploadRow({
  task,
  onRemove,
  onRetry,
  onUploadAnyway,
  onPickFile,
  disabled = false,
}: {
  task: UploadTask;
  onRemove: (id: string) => void;
  onRetry?: (id: string) => void;
  onUploadAnyway?: (id: string) => void;
  onPickFile?: (id: string, file: File) => void;
  /** A batch is running: actions that start uploads wait for it. */
  disabled?: boolean;
}) {
  const t = useTranslations("upload.row");
  const f = useFormat();
  const failureText = useUploadFailureText();
  const pickRef = useRef<HTMLInputElement>(null);
  const failed = task.status === "error";
  const active = task.status === "uploading" || task.status === "merging" || task.status === "checking";
  const name = task.file?.name ?? task.resume?.name ?? "";
  const sizeText = f.fileSize(task.file?.size ?? task.resume?.size ?? 0);
  const status = statusSentence(task, t);
  const duplicate = failed && task.error?.reason === "duplicate";

  return (
    <li className={`${styles.row} ${failed ? styles.rowFailed : ""} ${task.status === "paused" ? styles.rowPaused : ""}`}>
      <span className={styles.rowTile} aria-hidden="true">
        {iconFor(name)}
      </span>

      <span className={styles.rowBody}>
        <span className={`spine-body-sm ${styles.rowName}`} title={name}>
          {name}
        </span>

        {failed ? (
          <>
            {/* "Gagal — {sebab}" dalam kalimat Bahasa Indonesia, bukan teks
                mentah server. */}
            <span className={`spine-chip ${styles.rowMeta} ${styles.rowMetaErr}`}>
              {ICON_WARN}
              {t("failedBecause", { cause: task.error ? failureText(task.error, "row") : t("unknownCause") })}
            </span>
            <span className={`spine-chip ${styles.rowMeta}`}>
              {sizeText}
              {task.subSectionName ? (
                <span className={`spine-chip ${styles.subChip}`}>
                  {t("newSubSection", { name: task.subSectionName })}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className={`spine-chip ${styles.rowMeta}`}>
            {sizeText} · {status}
            {task.subSectionName ? (
              <span className={`spine-chip ${styles.subChip}`}>
                {t("newSubSection", { name: task.subSectionName })}
              </span>
            ) : null}
          </span>
        )}

        {active ? (
          <span
            className={styles.rowBar}
            role="progressbar"
            aria-label={t("progressOf", { name })}
            aria-valuenow={task.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={status}
          >
            <i style={{ width: `${task.progress}%` }} />
          </span>
        ) : null}
      </span>

      {/* Slot aksi kanan berukuran tetap (Epic 4 menyisipkan "Coba lagi"). */}
      <span className={styles.rowAction}>
        {task.status === "paused" && onPickFile ? (
          <>
            <PillButton variant="accent" className={styles.rowPill} onClick={() => pickRef.current?.click()}>
              {t("chooseFile")}
            </PillButton>
            <input
              ref={pickRef}
              type="file"
              className="spine-visually-hidden"
              tabIndex={-1}
              aria-label={t("chooseFileFor", { name })}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                e.target.value = "";
                if (picked) onPickFile(task.id, picked);
              }}
            />
          </>
        ) : null}
        {failed && !duplicate && onRetry && task.file ? (
          <PillButton
            variant="surface"
            className={styles.rowPill}
            aria-disabled={disabled || undefined}
            aria-label={t("retryLabel", { name })}
            onClick={() => (disabled ? undefined : onRetry(task.id))}
          >
            {t("retry")}
          </PillButton>
        ) : null}
        {duplicate && onUploadAnyway && task.file ? (
          <PillButton
            variant="surface"
            className={styles.rowPill}
            aria-disabled={disabled || undefined}
            aria-label={t("uploadAnywayLabel", { name })}
            onClick={() => (disabled ? undefined : onUploadAnyway(task.id))}
          >
            {t("uploadAnyway")}
          </PillButton>
        ) : null}
        {task.status === "pending" || task.status === "paused" || task.status === "skipped" ? (
          <button
            type="button"
            aria-label={task.status === "paused" ? t("discard", { name }) : t("remove", { name })}
            className={`spine-focus-ring ${styles.rowRemove}`}
            onClick={() => onRemove(task.id)}
          >
            {ICON_X}
          </button>
        ) : null}
        {active ? (
          <span className={`spine-display-sticker ${styles.rowPercent}`}>{task.progress}%</span>
        ) : null}
        {task.status === "success" ? (
          <span className={styles.rowDone} aria-hidden="true">
            {ICON_CHECK}
          </span>
        ) : null}
      </span>
    </li>
  );
}
