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
 * Slot aksi kanan sengaja punya lebar minimum: Epic 4 (FR30 / Story 4.9)
 * menyisipkan pill "Coba lagi" di sana tanpa menggeser tata letak. Di
 * gelombang ini pill itu TIDAK dirender.
 */

import React from "react";
import { formatFileSize } from "@/lib/format";
import type { UploadTask } from "./uploadTypes";
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

/** Kalimat status — selalu teks, tidak pernah warna saja. */
export function statusSentence(task: UploadTask): string {
  switch (task.status) {
    case "success":
      return "Selesai";
    case "merging":
      return "Menggabungkan…";
    case "uploading":
      return `Mengupload ${task.progress}%`;
    case "error":
      return "Gagal";
    default:
      return "Menunggu";
  }
}

export default function UploadRow({
  task,
  onRemove,
}: {
  task: UploadTask;
  onRemove: (id: string) => void;
}) {
  const failed = task.status === "error";
  const active = task.status === "uploading" || task.status === "merging";
  const sizeText = formatFileSize(task.file.size);

  return (
    <li className={`${styles.row} ${failed ? styles.rowFailed : ""}`}>
      <span className={styles.rowTile} aria-hidden="true">
        {iconFor(task.file.name)}
      </span>

      <span className={styles.rowBody}>
        <span className={`spine-body-sm ${styles.rowName}`} title={task.file.name}>
          {task.file.name}
        </span>

        {failed ? (
          <>
            {/* "Gagal — {sebab}" dalam kalimat Bahasa Indonesia, bukan teks
                mentah server. */}
            <span className={`spine-chip ${styles.rowMeta} ${styles.rowMetaErr}`}>
              {ICON_WARN}
              Gagal — {task.error ?? "sebab tidak diketahui"}
            </span>
            <span className={`spine-chip ${styles.rowMeta}`}>
              {sizeText}
              {task.subSectionName ? (
                <span className={`spine-chip ${styles.subChip}`}>
                  Sub-Section baru: {task.subSectionName}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <span className={`spine-chip ${styles.rowMeta}`}>
            {sizeText} · {statusSentence(task)}
            {task.subSectionName ? (
              <span className={`spine-chip ${styles.subChip}`}>
                Sub-Section baru: {task.subSectionName}
              </span>
            ) : null}
          </span>
        )}

        {active ? (
          <span
            className={styles.rowBar}
            role="progressbar"
            aria-label={`Progres ${task.file.name}`}
            aria-valuenow={task.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={statusSentence(task)}
          >
            <i style={{ width: `${task.progress}%` }} />
          </span>
        ) : null}
      </span>

      {/* Slot aksi kanan berukuran tetap (Epic 4 menyisipkan "Coba lagi"). */}
      <span className={styles.rowAction}>
        {task.status === "pending" ? (
          <button
            type="button"
            aria-label={`Hapus ${task.file.name} dari antrean`}
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
