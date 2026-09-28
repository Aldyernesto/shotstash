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
import { useTranslations } from "next-intl";
import type { UploadTask } from "./uploadTypes";
import { summarize } from "./uploadTypes";
import styles from "./upload.module.css";

export default function BatchProgress({ tasks }: { tasks: UploadTask[] }) {
  const t = useTranslations("upload.batch");
  const s = summarize(tasks);
  const figure = (chunks: React.ReactNode) => (
    <b className={`spine-display-sticker ${styles.batchFigure}`}>{chunks}</b>
  );
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
          {started
            ? t.rich("ofDone", { done: s.done, total: s.total, figure })
            : t.rich("ready", { count: s.total, figure })}
        </span>
        <span>
          {started && (s.running || s.waiting) ? (
            <>
              {t("runningWaiting", { running: s.running, waiting: s.waiting })}
            </>
          ) : null}
          {s.failed ? (
            <span className={styles.batchBad}>
              {started && (s.running || s.waiting) ? " · " : ""}
              {t("failed", { count: s.failed })}
            </span>
          ) : null}
        </span>
      </p>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={t("progress")}
        aria-valuenow={s.done}
        aria-valuemin={0}
        aria-valuemax={s.total}
        aria-valuetext={t("progressValue", { done: s.done, total: s.total })}
      >
        <i style={{ width: `${donePct}%` }} />
        {s.failed ? <i className={styles.bad} style={{ width: `${failPct}%` }} /> : null}
      </div>
    </div>
  );
}
