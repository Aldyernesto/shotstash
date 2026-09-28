"use client";

/**
 * Story 3.15 — `upload-dock`: panel kecil desktop dan HP.
 *
 * Dock membaca ANTREAN ASLI dari `UploadContext` (Story 3.14). Tidak ada
 * progres simulasi, tidak ada `setInterval` berangka acak, dan tidak ada
 * sumber kedua — persentase, jumlah file, dan nama Section di dock
 * selalu identik dengan yang tampil di `upload-panel` karena keduanya
 * membaca state yang sama.
 *
 * Dock TIDAK dirender sama sekali bila antrean kosong saat ia seharusnya
 * tampil (mis. state hilang karena hard reload di tengah batch) — lebih
 * baik tidak ada dock daripada "0 dari 0 file" atau angka tebakan. Tidak
 * ada pesan error yang muncul ke pengguna untuk keadaan itu; kejadiannya
 * dicatat ke konsol. Upload yang benar-benar terputus karena reload
 * diperlakukan sebagai batch yang BERAKHIR — tidak ada klaim "masih
 * berjalan" yang tidak benar.
 *
 * Dock tidak mengunci navigasi dan tidak menampilkan backdrop.
 */

import React, { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { useUpload } from "@/components/UploadContext";
import { parseSectionName } from "@/lib/sectionNumber";
import { summarize } from "./uploadTypes";
import styles from "./upload.module.css";

const ICON_UPLOAD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const ICON_UP = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 15l-6-6-6 6" />
  </svg>
);

const ICON_X = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function UploadDock() {
  const t = useTranslations("upload.dock");
  const q = useUpload();
  const ref = useRef<HTMLDivElement>(null);
  const warned = useRef(false);

  const visible = q.panelOpen && q.minimized && !!q.target;
  const empty = visible && q.tasks.length === 0;

  useEffect(() => {
    if (empty && !warned.current) {
      warned.current = true;
      console.warn(
        "[upload-dock] Queue is empty while the dock should show, so it is not rendered. " +
          "An upload cut off by a reload is treated as a finished batch.",
      );
    }
  }, [empty]);

  // `scroll-padding-bottom` ikut tinggi dock supaya fokus keyboard tidak
  // pernah tertutup olehnya (lapisan bawah HP: bottom-bar → dock → toast).
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--mam-dock-height");
      return;
    }
    const sync = () => {
      root.style.setProperty("--mam-dock-height", `${Math.round(el.getBoundingClientRect().height)}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--mam-dock-height");
    };
  }, [visible, empty]);

  if (!visible || empty) return null;

  const s = summarize(q.tasks);
  const section = parseSectionName(q.target!.folderName || "").title || t("sectionFallback");
  const stopped = !q.running && s.running === 0 && s.waiting === 0;
  const donePct = (s.done / s.total) * 100;
  const failPct = (s.failed / s.total) * 100;

  // Kegagalan DITULIS sebagai teks, tidak pernah hanya segmen berwarna.
  const title = stopped && !s.failed ? t("titleDone", { section }) : t("titleRunning", { section });
  const sub = stopped
    ? s.failed
      ? t("subDoneFailed", { done: s.done, total: s.total, failed: s.failed })
      : t("subDone", { done: s.done, total: s.total })
    : s.failed
      ? t("subRunningFailed", { done: s.done, total: s.total, failed: s.failed })
      : t("subRunning", { done: s.done, total: s.total, running: s.running });

  return (
    <div className={styles.dock} ref={ref} role="region" aria-label={t("region")}>
      <div className={styles.dockHead}>
        <span className={styles.dockIcon} aria-hidden="true">
          {ICON_UPLOAD}
        </span>
        <span className={styles.dockText} role="status">
          <b className={`spine-body-sm ${styles.dockTitle}`}>{title}</b>
          <span className={`spine-chip ${styles.dockSub}`}>{sub}</span>
        </span>
        <span className={styles.dockButtons}>
          <button
            type="button"
            aria-label={t("showList")}
            title={t("show")}
            className={`spine-focus-ring ${styles.dockButton}`}
            onClick={() => q.setMinimized(false)}
          >
            {ICON_UP}
          </button>
          {/* Tombol tutup baru ADA setelah seluruh antrean berhenti —
              selesai atau gagal — supaya baris gagal tidak hilang sebelum
              pengguna sempat melihatnya. */}
          {stopped ? (
            <button
              type="button"
              aria-label={t("closePanel")}
              title={t("close")}
              className={`spine-focus-ring ${styles.dockButton}`}
              onClick={q.finish}
            >
              {ICON_X}
            </button>
          ) : null}
        </span>
      </div>
      <div
        className={`${styles.track} ${styles.dockTrack}`}
        role="progressbar"
        aria-label={t("progress")}
        aria-valuenow={s.done}
        aria-valuemin={0}
        aria-valuemax={s.total}
        aria-valuetext={sub}
      >
        <i style={{ width: `${donePct}%` }} />
        {s.failed ? <i className={styles.bad} style={{ width: `${failPct}%` }} /> : null}
      </div>
    </div>
  );
}
