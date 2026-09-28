"use client";

/**
 * Story 3.12 — `upload-panel`: kerangka panel, tujuan, dropzone, slot
 * antrean, dan footer. Isi barisnya (`upload-row`), progres batch
 * (`batch-progress`), dan pertanyaan HEIC (`heic-question`) datang dari
 * Story 3.13; tombol "Kecilkan" dari Story 3.15.
 *
 * Menggantikan `src/components/UploadModal.tsx` (overlay
 * `page.module.css`, dialog HEIC bertumpuk di atas dialog, tombol
 * `bulkBtn*`). Kotak, sudut, jebakan fokus, dan aturan satu lapisan
 * modal datang dari `Dialog` Story 3.1 — varian `size="lg"` 520 px
 * dengan padding 28/28/24.
 *
 * Story 3.14: panel TIDAK menyimpan antrean sendiri. Seluruh state
 * datang dari `UploadContext`, jadi panel, `upload-row`,
 * `batch-progress`, dan `upload-dock` membaca angka yang sama persis,
 * dan menutup panel tidak membatalkan batch maupun menghapus riwayat.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@/components/overlay/Dialog";
import { PillButton } from "@/components/form/buttons";
import { FormAlert } from "@/components/form/FormAlert";
import { parseSectionName } from "@/lib/sectionNumber";
import { acceptForFolder, useUpload } from "@/components/UploadContext";
import { summarize } from "./uploadTypes";
import UploadRow from "./UploadRow";
import BatchProgress from "./BatchProgress";
import { HeicActions, HeicBody } from "./HeicQuestion";
import styles from "./upload.module.css";

const CHEVRON_DOWN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const UPLOAD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

/** True where the primary pointer can hover (mouse); touch screens get "Tap". */
function useHoverPointer() {
  const [hover, setHover] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover)");
    const on = () => setHover(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return hover;
}

export default function UploadPanel() {
  const t = useTranslations("upload");
  const tc = useTranslations("common");
  const hoverPointer = useHoverPointer();
  const q = useUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [askHeic, setAskHeic] = useState(false);
  const heicTitleId = useId();

  const parsed = parseSectionName(q.target?.folderName || "");
  const accept = acceptForFolder(q.target?.folderType || q.target?.folderName || "");
  const sum = summarize(q.tasks);
  const finished = q.tasks.length > 0 && sum.running === 0 && sum.waiting === 0 && !q.running;

  // Kembali online → `form-alert` offline hilang sendiri, TAPI batch tidak
  // dimulai otomatis: penekanan tetap milik pengguna (AC 3.12).
  const setRejection = q.setRejection;
  useEffect(() => {
    const onOnline = () => setRejection((prev) => (prev === "offline" ? null : prev));
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [setRejection]);

  const summaryText = useMemo(() => {
    if (!q.tasks.length) return "";
    if (finished) {
      return sum.failed
        ? t("panel.summaryDoneFailed", { done: sum.done, failed: sum.failed })
        : t("panel.summaryDone", { done: sum.done });
    }
    if (q.running) {
      return t("panel.summaryRunning", {
        done: sum.done,
        total: sum.total,
        running: sum.running,
        waiting: sum.waiting,
      });
    }
    // Sebelum batch dimulai ringkasan footer KOSONG: angkanya sudah ada
    // di `batch-progress` tepat di atasnya (mock 01/03b).
    return "";
  }, [finished, q.running, q.tasks.length, sum, t]);

  if (!q.panelOpen || q.minimized || !q.target) return null;

  const primary = async () => {
    if (q.running) return;
    if (finished) {
      q.finish();
      return;
    }
    // Pertanyaan HEIC MENGGANTI isi panel — tidak ada dialog kedua.
    if (q.hasHeic && q.convertHeic === null) {
      setAskHeic(true);
      return;
    }
    await q.start();
  };

  const answerHeic = async (convert: boolean) => {
    q.setConvertHeic(convert);
    setAskHeic(false);
    await q.start();
  };

  const primaryLabel = finished ? t("panel.done") : t("panel.uploadCount", { count: sum.waiting });

  return (
    <Dialog
      size="lg"
      mobilePlacement="bottom"
      mobilePreviewFirst={false}
      title={askHeic ? t("heic.title") : t("panel.title")}
      closeLabel={t("panel.close")}
      closeDisabled={q.running || askHeic}
      /* Esc tidak berefek selama batch berjalan ATAU selama pertanyaan
         HEIC belum dijawab (AC 3.12 & 3.13). */
      locked={q.running || askHeic}
      onClose={q.running || askHeic ? () => undefined : q.closePanel}
      headerExtra={
        /* Story 3.15: "Kecilkan" — serah-terima ke `upload-dock`.
           Upload TETAP berjalan setelah panel diperkecil. */
        !askHeic && q.tasks.length > 0 ? (
          <button
            type="button"
            aria-label={t("panel.minimizeLabel")}
            title={t("panel.minimize")}
            className={`spine-focus-ring ${styles.headerButton}`}
            onClick={() => q.setMinimized(true)}
          >
            {CHEVRON_DOWN}
          </button>
        ) : null
      }
      footer={
        askHeic ? (
          <HeicActions onConvert={() => answerHeic(true)} onKeep={() => answerHeic(false)} />
        ) : (
          <div className={styles.footer}>
            {summaryText ? (
              <span className={`spine-body-sm ${styles.summary}`} role="status">
                {summaryText}
              </span>
            ) : null}
            <PillButton
              variant="surface"
              aria-disabled={q.running || undefined}
              className={q.running ? styles.disabled : undefined}
              onClick={() => (q.running ? undefined : q.closePanel())}
            >
              {t("panel.cancel")}
            </PillButton>
            <PillButton
              variant="accent"
              busy={q.running}
              busyLabel={t("panel.uploading")}
              aria-disabled={(!q.tasks.length && !finished) || undefined}
              onClick={primary}
            >
              {!finished ? (
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 16, height: 16 }}>
                  {UPLOAD_ICON}
                </span>
              ) : null}
              {primaryLabel}
            </PillButton>
          </div>
        )
      }
    >
      {askHeic ? (
        /* Pertanyaan HEIC MENGGANTI isi panel — bukan dialog kedua. */
        <HeicBody titleId={heicTitleId} />
      ) : (
        <>
          <p className={`spine-body ${styles.target}`}>
            {t.rich("panel.to", {
              number: parsed.number ? String(parsed.number) : "none",
              section: parsed.title || t("panel.sectionFallback"),
              sticker: (chunks) => (
                <span className={`spine-display-label ${styles.sticker}`}>
                  <small className="spine-sticker-unit" aria-hidden="true">
                    {tc("numberPrefix")}
                  </small>
                  <span className="spine-visually-hidden">{tc("number")} </span>
                  {chunks}
                </span>
              ),
              name: (chunks) => <b className="spine-display-card">{chunks}</b>,
            })}
          </p>

          <p className={`spine-body-sm ${styles.help}`}>
            {hoverPointer ? t("panel.helpPointer") : t("panel.helpTouch")}
          </p>

          <button
            type="button"
            aria-disabled={q.running || undefined}
            className={`spine-body-sm spine-focus-ring ${styles.dropzone} ${
              dragOver ? styles.dropzoneOver : ""
            } ${q.running ? styles.disabled : ""}`}
            onClick={() => {
              if (!q.running) inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!q.running) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOver(false);
              if (q.running) return;
              await q.addDrop(e.dataTransfer);
            }}
          >
            {UPLOAD_ICON}
            {dragOver ? t("panel.dropHere") : hoverPointer ? t("panel.dropzonePointer") : t("panel.dropzoneTouch")}
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept || undefined}
            className="spine-visually-hidden"
            onChange={(e) => {
              q.addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          {/* `batch-progress` (Story 3.13). */}
          <BatchProgress tasks={q.tasks} />

          {/* Slot daftar antrean bergulir + bayangan 36px di tepi bawah. */}
          {q.tasks.length > 0 ? (
            <ul className={styles.queue}>
              {q.tasks.map((task) => (
                <UploadRow key={task.id} task={task} onRemove={q.removeTask} />
              ))}
              <li className={styles.queueFade} aria-hidden="true" />
            </ul>
          ) : null}
        </>
      )}

      {/* Penolakan batch — `form-alert` di DALAM panel, tepat di atas footer.
          Antrean tetap utuh dan tidak ada baris yang ditandai gagal. */}
      {q.rejection ? (
        <FormAlert tone="danger" className={styles.alert}>
          {t(`reject.${q.rejection}`)}
          {q.rejection === "missingFolder" ? (
            <>
              {" "}
              {/* Membuka kembali pemilih Section tujuan TANPA membuang
                  antrean: halaman yang sedang tampil yang merendernya. */}
              <PillButton
                variant="surface"
                onClick={() => {
                  q.closePanel();
                  window.dispatchEvent(new CustomEvent("mam:upload-pick-section"));
                }}
              >
                {t("panel.pickOtherSection")}
              </PillButton>
            </>
          ) : null}
        </FormAlert>
      ) : null}
    </Dialog>
  );
}
