"use client";

/**
 * Story 3.5 — `file-viewer`: SATU lapisan di atas grid.
 *
 * Tidak pernah bertumpuk dengan lapisan lain (aturan satu lapisan modal,
 * `modalStack.ts`), tanpa blur latar, tanpa film-strip, dan SELALU GELAP
 * di dua tema. Satu-satunya bagian yang ikut tema adalah
 * `viewer-info-panel` / `viewer-info-sheet` (Story 3.6).
 *
 * Urutan prev/next mengikuti urutan yang SEDANG TAMPIL di grid atau mode
 * daftar: pemanggil mengoper `files` yang sudah terurut dan sudah
 * disaring ke foto + video saja (dokumen tidak pernah masuk urutan ini
 * dan tidak dibuka di viewer).
 *
 * Story 5.4: `renderInfoExtra` adds the Processing section to the info
 * panel / sheet, `renderTopExtra` a job chip next to the title; a video or
 * image version opened from the info panel plays instead of the original
 * until "Show original" (or another file).
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import styles from "./fileViewer.module.css";
import VideoPlayer, { type VideoPlayerHandle } from "./VideoPlayer";
import { formatClock } from "@/lib/format";
import { useFocusTrap, useModalLayer } from "@/components/overlay/modalStack";
import { ErrorBox } from "@/components/dashboard/states";
import { ViewerInfo, useKindLabel, type ViewerInfoFile, type ViewerVersion } from "./ViewerInfo";

export type ViewerFile = ViewerInfoFile & {
  id: string;
  originalName: string;
  mimeType: string;
  thumbnailUrl?: string | null;
};

export type FileViewerProps = {
  /** Sudah terurut & sudah disaring ke foto + video saja. */
  files: ViewerFile[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** URL media inline untuk file ini. */
  srcOf: (file: ViewerFile) => string;
  posterOf?: (file: ViewerFile) => string | undefined;
  projectTitle?: string | null;
  sectionName?: string | null;
  onShare?: (file: ViewerFile) => void;
  /** Regular download (the viewer accent pill). */
  onDownload?: (file: ViewerFile) => void;
  /**
   * Slot aksi unduh. Story 3.7 menaruh `progress-pill` Agen di sini
   * tanpa viewer perlu tahu apa pun tentang role. Bila diisi, ia
   * MENGGANTIKAN tombol unduh bawaan.
   */
  renderDownload?: (file: ViewerFile) => React.ReactNode;
  /** Kalimat bantuan di bawah aksi (Story 3.7: kalimat perisai Agen). */
  actionNote?: React.ReactNode;
  /** Story 5.4: the Processing section of the info panel / sheet. */
  renderInfoExtra?: (file: ViewerFile) => React.ReactNode;
  /** Story 5.4: a chip next to the title (the file's job). */
  renderTopExtra?: (file: ViewerFile) => React.ReactNode;
};

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 900px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const PrevIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 5.5L8 12l6.5 6.5" />
  </svg>
);
const NextIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.5 5.5L16 12l-6.5 6.5" />
  </svg>
);
const InfoIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </svg>
);
const ShareIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="18" cy="5.5" r="2.6" />
    <circle cx="6" cy="12" r="2.6" />
    <circle cx="18" cy="18.5" r="2.6" />
    <path d="M8.4 13.3l7.2 4.2M15.6 6.8L8.4 10.9" />
  </svg>
);

function kindOf(mime: string): "video" | "photo" {
  return mime.startsWith("video/") ? "video" : "photo";
}

/** Lebar × tinggi TAMPIL media yang sedang terbuka + durasi detik (video).
    `key` = file + percobaan yang menghasilkannya: saat file berganti, meta
    lama langsung dianggap tidak ada PADA RENDER YANG SAMA (bukan lewat
    effect reset yang menyisakan satu frame rasio/Dimensi file lama). */
type MediaMeta = { key: string; width: number; height: number; duration?: number };

/* Batas lebar kotak video lanskap di desktop (nilai Story 3.5). Potret tidak
   pernah menyentuhnya: tingginya yang membatasi. */
const VIDEO_MAX_WIDTH = 1100;
/* Rasio kotak video sebelum metadata terbaca — 16/9 seperti `.dmedia` mock. */
const VIDEO_FALLBACK_RATIO = 16 / 9;

export default function FileViewer({
  files,
  index,
  onIndexChange,
  onClose,
  srcOf,
  posterOf,
  projectTitle,
  sectionName,
  onShare,
  onDownload,
  renderDownload,
  actionNote,
  renderInfoExtra,
  renderTopExtra,
}: FileViewerProps) {
  const t = useTranslations("viewer");
  const kindLabel = useKindLabel();
  /** Story 5.4: a processed version shown instead of the original (this file only). */
  const [shown, setShown] = useState<{ fileId: string; version: ViewerVersion } | null>(null);
  const desktop = useIsDesktop();
  const overlayRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  // Story 3.6: panel info terbuka secara bawaan di desktop [ASSUMPTION].
  const [infoOpen, setInfoOpen] = useState(desktop);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  /* Dimensi/durasi file yang sedang terbuka, dibaca dari elemen media —
     satu-satunya sumber hari ini (MediaFile tanpa lebar/tinggi/durasi). */
  const [meta, setMeta] = useState<MediaMeta | null>(null);
  /* Ukuran `.stage` yang tersedia; kotak video dihitung PAS di dalamnya
     (mock key-file-viewer: media disusun dari tinggi, rasio ikut berkas). */
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => setMounted(true), []);

  /* Diulang saat file/indeks berganti: bila viewer sempat merender null
     (indeks di luar jangkauan) lalu hidup lagi, `.stage` baru ikut diamati. */
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStage((s) => (s && s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    // Tanpa ResizeObserver (sangat tua) ukuran hanya diukur sekali per file —
    // perubahan ukuran jendela tidak diikuti; diterima sebagai degradasi.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted, index, files.length]);

  const file = files[index];
  const total = files.length;
  const version = shown && file && shown.fileId === file.id ? shown.version : null;
  const mediaKey = `${file?.id ?? ""}-${version?.id ?? "o"}-${retryKey}`;

  /* Esc BERURUTAN: keluar layar penuh → tutup lembar/panel info →
     tutup viewer. Satu tingkat per tekan, tidak pernah melompat. */
  const onEsc = useCallback(() => {
    if (playerRef.current?.exitFullscreenIfAny()) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (infoOpen && !desktop) {
      setInfoOpen(false);
      infoButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    onClose();
  }, [infoOpen, desktop, onClose]);

  useModalLayer(onEsc, { modal: true });
  useFocusTrap(overlayRef, { active: mounted });

  const go = useCallback(
    (delta: number) => {
      if (total < 2) return;
      onIndexChange((index + delta + total) % total);
    },
    [index, total, onIndexChange],
  );

  useEffect(() => {
    setFailed(false);
    setLoading(true);
  }, [file?.id, version?.id, retryKey]);

  /* ← → di mana pun di viewer = pindah file. Aturan "kecuali saat
     scrubber memegang fokus" ditegakkan di sini juga, supaya foto dan
     video memakai peta yang sama. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.getAttribute("role") === "slider") return;
      e.preventDefault();
      go(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  /* Geser kiri/kanan di HP (foto; video diurus `VideoPlayer`). */
  const touch = useRef<{ x: number; y: number } | null>(null);

  const kind = file ? kindOf(version?.mimeType ?? file.mimeType) : "photo";
  const counter = useMemo(
    () => t("counter", { kind, index: index + 1, total }),
    [t, kind, index, total],
  );

  if (!mounted || !file) return null;

  const toggleInfo = () => setInfoOpen((v) => !v);

  /* Kotak video: lebar = min(lebar stage, tinggi stage × rasio, 1100),
     tinggi = lebar ÷ rasio → PAS memeluk video, tidak pernah melampaui
     stage, potret berdiri tegak. Sebelum stage terukur (hanya render
     pertama sebelum paint) CSS `.videoBox` menjadi cadangan. */
  // Meta hanya berlaku untuk file + percobaan yang sedang tampil.
  const metaNow = meta && meta.key === mediaKey ? meta : null;
  const videoRatio = metaNow ? metaNow.width / metaNow.height : VIDEO_FALLBACK_RATIO;
  const videoBoxStyle =
    kind === "video" && stage && stage.w > 0 && stage.h > 0
      ? (() => {
          const w = Math.min(stage.w, stage.h * videoRatio, VIDEO_MAX_WIDTH);
          return { width: Math.floor(w), height: Math.floor(w / videoRatio) };
        })()
      : undefined;

  // Nilai dari elemen media menang; bila kelak server menyimpan lebar/tinggi/
  // durasi (deferred-work), nilai server tampil lebih dulu sebagai cadangan.
  // Durasi tak dikenal (fMP4/WebM tanpa header durasi) = tidak ditulis,
  // bukan "00:00".
  const infoFile = {
    ...file,
    width: metaNow?.width ?? file.width ?? null,
    height: metaNow?.height ?? file.height ?? null,
    duration:
      metaNow?.duration != null && Number.isFinite(metaNow.duration) && metaNow.duration > 0
        ? formatClock(metaNow.duration)
        : file.duration ?? null,
  };
  /* Foto: batas piksel EKSPLISIT dari stage. `max-height: 100%` pada <img>
     tidak berlaku karena tinggi pembungkusnya auto (persentase → none), jadi
     foto potret hanya dibatasi lebar dan terpotong oleh overflow: hidden. */
  const photoStyle = stage && stage.w > 0 && stage.h > 0 ? { maxWidth: stage.w, maxHeight: stage.h } : undefined;

  const mediaNode = failed ? (
    <div className={styles.errorWrap}>
      <ErrorBox
        title={t("loadFailedTitle")}
        text={t("loadFailedText")}
        retryLabel={t("retry")}
        onRetry={() => setRetryKey((k) => k + 1)}
      />
    </div>
  ) : kind === "video" ? (
    <div className={`${styles.media} ${styles.videoBox}`} style={videoBoxStyle}>
      <VideoPlayer
        ref={playerRef}
        key={mediaKey}
        className={styles.player}
        src={version ? version.downloadUrl : srcOf(file)}
        poster={posterOf?.(file)}
        label={file.originalName}
        autoPlay
        onPrevFile={() => go(-1)}
        onNextFile={() => go(1)}
        onMetadata={(m) => setMeta({ key: mediaKey, width: m.width, height: m.height, duration: m.duration })}
      />
    </div>
  ) : (
    <div className={styles.media}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={mediaKey}
        className={styles.photo}
        style={photoStyle}
        src={version ? version.downloadUrl : srcOf(file)}
        alt={file.originalName}
        onLoad={(e) => {
          setLoading(false);
          // naturalWidth/Height sudah mengikuti orientasi EXIF (image-orientation: from-image).
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setMeta({ key: mediaKey, width: img.naturalWidth, height: img.naturalHeight });
          }
        }}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
      />
    </div>
  );

  const DownloadIcon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
    </svg>
  );
  const downloadNode =
    renderDownload?.(file) ??
    (onDownload ? (
      <button
        type="button"
        className={`${styles.pill} ${styles.pillAccent}`}
        onClick={() => onDownload(file)}
      >
        {DownloadIcon}
        {t("download")}
      </button>
    ) : null);
  const shareNode = onShare ? (
    <button
      type="button"
      className={desktop ? styles.pill : styles.iconButton}
      aria-label={desktop ? undefined : t("shareFile", { name: file.originalName })}
      onClick={() => onShare(file)}
    >
      {ShareIcon}
      {desktop ? t("share") : null}
    </button>
  ) : null;

  return createPortal(
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      className={styles.overlay}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start || kind === "video") return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(t.clientY - start.y)) return;
        go(dx > 0 ? -1 : 1);
      }}
    >
      <div className={styles.top}>
        <div className={styles.topLeft}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t("closeViewer")}
            onClick={onClose}
          >
            {CloseIcon}
          </button>
          <div className={styles.title}>
            <b id={labelId} className={styles.titleName}>
              {file.originalName}
            </b>
            {/* Penghitung "5 / 72" diumumkan POLITE setiap kali file berganti. */}
            <span className={styles.titleMeta} aria-live="polite">
              {counter}
            </span>
          </div>
          {renderTopExtra && desktop ? <div className={styles.topExtra}>{renderTopExtra(file)}</div> : null}
          {version ? (
            <div className={styles.showing}>
              <span className={styles.showingLabel}>{t("showingVersion", { kind: kindLabel(version) })}</span>
              <button type="button" className={styles.showingButton} onClick={() => setShown(null)}>
                {t("showOriginal")}
              </button>
            </div>
          ) : null}
          {!desktop ? (
            <span className={styles.counterChip} aria-live="polite">
              {index + 1} / {total}
            </span>
          ) : null}
        </div>
        <div className={styles.topRight}>
          <button
            ref={infoButtonRef}
            type="button"
            className={styles.iconButton}
            aria-label={t("info.title")}
            aria-expanded={infoOpen}
            onClick={toggleInfo}
          >
            {InfoIcon}
          </button>
          {desktop ? shareNode : null}
          {desktop ? downloadNode : null}
        </div>
      </div>

      {actionNote && desktop ? <div className={styles.noteRow}>{actionNote}</div> : null}

      <div className={styles.body} data-info={infoOpen ? "true" : undefined}>
        <div ref={stageRef} className={styles.stage}>
          {loading && kind === "photo" && !failed ? (
            <span className={styles.placeholder} style={photoStyle} aria-hidden="true" />
          ) : null}
          {mediaNode}
          {total > 1 && !failed ? (
            <>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.navPrev}`}
                aria-label={t("prevKey")}
                onClick={() => go(-1)}
              >
                {PrevIcon}
              </button>
              <button
                type="button"
                className={`${styles.iconButton} ${styles.navNext}`}
                aria-label={t("nextKey")}
                onClick={() => go(1)}
              >
                {NextIcon}
              </button>
            </>
          ) : null}
        </div>

        {infoOpen && desktop ? (
          <ViewerInfo
            variant="panel"
            file={infoFile}
            projectTitle={projectTitle}
            sectionName={sectionName}
            extra={renderInfoExtra?.(file)}
            onOpenVersion={(v) => setShown({ fileId: file.id, version: v })}
            openVersionId={version?.id ?? null}
            onClose={() => {
              setInfoOpen(false);
              infoButtonRef.current?.focus({ preventScroll: true });
            }}
          />
        ) : null}
      </div>

      {!desktop ? (
        <>
          <div className={styles.mobileNav}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t("prev")}
              onClick={() => go(-1)}
            >
              {PrevIcon}
            </button>
            <div className={styles.mobileNavText}>
              <b>{file.originalName}</b>
              <span>{counter}</span>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t("next")}
              onClick={() => go(1)}
            >
              {NextIcon}
            </button>
          </div>
          <div className={styles.mobileActions}>
            {renderTopExtra ? <div className={styles.topExtra}>{renderTopExtra(file)}</div> : null}
            {downloadNode}
            {shareNode}
          </div>
          {/* <div>, BUKAN <p>: `actionNote` sendiri sudah berupa paragraf
              (`SafeNote`), dan <p> di dalam <p> adalah HTML tidak sah. */}
          {actionNote ? <div className={styles.actionNote}>{actionNote}</div> : null}
        </>
      ) : null}

      <div className={styles.hint}>
        {desktop ? (
          t.rich("keyHints", {
            kbd: (chunks) => <kbd>{chunks}</kbd>,
            sep: () => <i>|</i>,
          })
        ) : (
          t("swipeHint")
        )}
      </div>

      {infoOpen && !desktop ? (
        <ViewerInfo
          variant="sheet"
          file={infoFile}
          projectTitle={projectTitle}
          sectionName={sectionName}
          extra={renderInfoExtra?.(file)}
          onOpenVersion={(v) => setShown({ fileId: file.id, version: v })}
          openVersionId={version?.id ?? null}
          onClose={() => {
            setInfoOpen(false);
            infoButtonRef.current?.focus({ preventScroll: true });
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}
