"use client";

/**
 * Story 3.13 — `batch-progress`.
 *
 * Angka huruf display besar + "dari 72 file selesai" di kiri, ringkasan
 * berjalan/menunggu di kanan, dan a 6px accent track with segments
 * `{colors.danger}` untuk yang gagal — jumlah gagal DITULIS sebagai
 * teks, tidak pernah hanya warna segmen (NFR15).
 *
 * Pengumumannya POLITE dan per tahap, bukan tiap persen: `aria-valuetext`
 * berubah per file selesai, bukan per persen potongan.
 */

import React from "react";
import { formatNumber } from "@/lib/format";
import type { UploadTask } from "./uploadTypes";
import { summarize } from "./uploadTypes";
import styles from "./upload.module.css";

export default function BatchProgress({ tasks }: { tasks: UploadTask[] }) {
  const s = summarize(tasks);
  if (!s.total) return null;

  const donePct = (s.done / s.total) * 100;
  const failPct = (s.failed / s.total) * 100;
  const started = s.done + s.failed + s.running > 0;

  return (
    <div className={styles.batch}>
      <p className={`spine-body-sm ${styles.batchTop}`}>
        <span>
          {/* Sebelum batch dimulai mock menulis "{n} file siap diupload"
              dengan angka TOTAL; setelah mulai, angkanya jumlah selesai. */}
          <b className={`spine-display-sticker ${styles.batchFigure}`}>
            {formatNumber(started ? s.done : s.total)}
          </b>
          {started ? `dari ${formatNumber(s.total)} file selesai` : "file siap diupload"}
        </span>
        <span>
          {started && (s.running || s.waiting) ? (
            <>
              {formatNumber(s.running)} sedang diupload · {formatNumber(s.waiting)} menunggu
            </>
          ) : null}
          {s.failed ? (
            <span className={styles.batchBad}>
              {started && (s.running || s.waiting) ? " · " : ""}
              {formatNumber(s.failed)} gagal
            </span>
          ) : null}
        </span>
      </p>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="Progres batch"
        aria-valuenow={s.done}
        aria-valuemin={0}
        aria-valuemax={s.total}
        aria-valuetext={`${formatNumber(s.done)} dari ${formatNumber(s.total)} file selesai`}
      >
        <i style={{ width: `${donePct}%` }} />
        {s.failed ? <i className={styles.bad} style={{ width: `${failPct}%` }} /> : null}
      </div>
    </div>
  );
}
