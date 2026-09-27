"use client";

/**
 * Story 3.4 — `video-controls` kustom menggantikan kontrol bawaan browser.
 *
 * SATU komponen untuk KETIGA tempat pemakaian (viewer `file-viewer`,
 * halaman `/s/[slug]`, dan `pipeline-card` worker). Yang berbeda hanya
 * ukuran tombol tengah lewat prop `playSize` — tidak ada salinan kedua
 * `video-controls` per layar.
 *
 * Peta keyboard (EXPERIENCE.md → `video-controls`, bagian dari kontrak):
 *   Spasi / K ..... putar ↔ jeda (fokus di mana pun kecuali tombol lain)
 *   M ............. bisu ↔ nyalakan suara
 *   F ............. layar penuh ↔ keluar layar penuh
 *   ← / → ......... file sebelumnya / berikutnya — KECUALI saat scrubber
 *                   memegang fokus: di sana ± 5 detik
 *   Home / End .... hanya saat scrubber fokus: awal / akhir video
 * Esc BERURUTAN (keluar layar penuh → tutup panel info → tutup viewer)
 * dimiliki pemilik lapisan; komponen ini hanya melaporkan lewat
 * `isFullscreen()` dan menangani tingkat "keluar layar penuh".
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import styles from "./videoControls.module.css";
import { formatClock } from "@/lib/format";

const SEEK_STEP = 5;
const AUTOHIDE_MS = 3000;
const SWIPE_PX = 56;

export type VideoPlayerHandle = {
  /** true bila permintaan keluar layar penuh benar-benar dilakukan. */
  exitFullscreenIfAny: () => boolean;
  isFullscreen: () => boolean;
  /** The underlying element (Story 2.3: re-signed share URLs resume from here). */
  element: () => HTMLVideoElement | null;
};

/** Ukuran tampil video (SUDAH dikoreksi rotasi oleh browser) + durasi
    detik, dilaporkan saat `loadedmetadata` / `durationchange` /
    `resize`. Nol perubahan server: ini satu-satunya sumber Dimensi hari
    ini (MediaFile tidak menyimpan lebar/tinggi/durasi). */
export type VideoMetadata = { width: number; height: number; duration: number };

export type VideoPlayerProps = {
  src: string;
  poster?: string | null;
  /** Nama aksesibel media (biasanya nama file). */
  label: string;
  /** `lg` = 76px (viewer & halaman share); `sm` = 56px (pipeline-card). */
  playSize?: "lg" | "sm";
  autoPlay?: boolean;
  className?: string;
  /** ← / geser kanan di LUAR scrubber = file sebelumnya. */
  onPrevFile?: () => void;
  /** → / geser kiri di LUAR scrubber = file berikutnya. */
  onNextFile?: () => void;
  /** Dipanggil begitu lebar × tinggi tampil diketahui (lihat VideoMetadata). */
  onMetadata?: (meta: VideoMetadata) => void;
  /** The source failed to load (for example an expired signed URL). */
  onSourceError?: () => void;
};

const PlayIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M6 3.5l14 8.5-14 8.5z" />
  </svg>
);
const PauseIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5.5" y="4" width="4.5" height="16" rx="1.2" />
    <rect x="14" y="4" width="4.5" height="16" rx="1.2" />
  </svg>
);
const VolumeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" />
    <path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
  </svg>
);
const MutedIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9.5h3.2L12 5.4v13.2L7.2 14.5H4z" />
    <path d="M16 9.6l5 4.8M21 9.6l-5 4.8" />
  </svg>
);
const FullscreenIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 9V4.6h4.6M20 9V4.6h-4.6M4 15v4.4h4.6M20 15v4.4h-4.6" />
  </svg>
);
const ExitFullscreenIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8.8 4.6V9H4.4M15.2 4.6V9h4.4M8.8 19.4V15H4.4M15.2 19.4V15h4.4" />
  </svg>
);

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { src, poster, label, playSize = "lg", autoPlay = false, className, onPrevFile, onNextFile, onMetadata, onSourceError },
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [controlsHidden, setControlsHidden] = useState(false);
  /* Rasio tampil video → `--vp-ratio` di pembungkus, supaya kotak pemutar
     berdiri tegak untuk video potret (mock: "Video potret dari HP kru;
     video lanskap … media 16:9"). Sebelum metadata: 16/9 dari CSS. */
  const [videoRatio, setVideoRatio] = useState<number | null>(null);
  const onMetadataRef = useRef(onMetadata);
  useEffect(() => {
    onMetadataRef.current = onMetadata;
  });

  useImperativeHandle(ref, () => ({
    isFullscreen: () => !!document.fullscreenElement,
    element: () => videoRef.current,
    exitFullscreenIfAny: () => {
      if (!document.fullscreenElement) return false;
      void document.exitFullscreen().catch(() => undefined);
      return true;
    },
  }));

  /* ---------------------------------------------------------------
     Tampil / sembunyi. Kontrol TIDAK PERNAH sembunyi saat dijeda, saat
     memuat, atau selama salah satu kontrol memegang fokus keyboard.
     --------------------------------------------------------------- */
  const keepVisible = useCallback(() => {
    setControlsHidden(false);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    const wrap = wrapRef.current;
    const focusInside = !!wrap && wrap.contains(document.activeElement);
    const video = videoRef.current;
    if (!video || video.paused || buffering || focusInside) return;
    hideTimer.current = window.setTimeout(() => setControlsHidden(true), AUTOHIDE_MS);
  }, [buffering]);

  useEffect(() => {
    keepVisible();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [keepVisible, playing]);

  /* ---------------------------------------------------------------
     Keadaan media
     --------------------------------------------------------------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setVideoRatio(null);
    // Laporkan ke pemilik hanya bila lebar/tinggi/durasi benar-benar berubah
    // (durationchange/resize bisa menyala berulang dengan nilai sama).
    let reported = "";

    const onTime = () => {
      setCurrent(video.currentTime);
      try {
        const b = video.buffered;
        setBuffered(b.length ? b.end(b.length - 1) : 0);
      } catch {
        setBuffered(0);
      }
    };
    const onMeta = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      setDuration(d);
      const { videoWidth: w, videoHeight: h } = video;
      if (w > 0 && h > 0) {
        setVideoRatio(w / h);
        const sig = `${w}x${h}@${d}`;
        if (sig !== reported) {
          reported = sig;
          onMetadataRef.current?.({ width: w, height: h, duration: d });
        }
      }
    };
    const onPlay = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onVolume = () => setMuted(video.muted);

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("progress", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("durationchange", onMeta);
    // 'resize' menyala bila videoWidth/videoHeight berubah (mis. stream adaptif).
    video.addEventListener("resize", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onPlaying);
    video.addEventListener("volumechange", onVolume);
    // Halaman share merender <video> di HTML server: metadata bisa SUDAH
    // termuat sebelum listener terpasang (hidrasi), sehingga
    // loadedmetadata/durationchange tidak pernah terdengar. Baca sekali.
    if (video.readyState >= 1) onMeta();
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("progress", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("durationchange", onMeta);
      video.removeEventListener("resize", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onPlaying);
      video.removeEventListener("volumechange", onVolume);
    };
  }, [src]);

  useEffect(() => {
    const onFs = () => {
      setFullscreen(!!document.fullscreenElement);
      keepVisible();
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [keepVisible]);

  /* ---------------------------------------------------------------
     Aksi
     --------------------------------------------------------------- */
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void wrap.requestFullscreen?.().catch(() => undefined);
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(Math.max(0, video.currentTime + delta), video.duration || 0);
    video.currentTime = next;
    setCurrent(next);
  }, []);

  const seekTo = useCallback((ratio: number) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const next = Math.min(Math.max(0, ratio), 1) * video.duration;
    video.currentTime = next;
    setCurrent(next);
  }, []);

  const seekFromPointer = (clientX: number) => {
    const el = scrubRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    seekTo((clientX - rect.left) / rect.width);
  };

  /* ---------------------------------------------------------------
     Keyboard — dipasang di pembungkus, jadi berlaku "di mana pun di
     dalam viewer kecuali tombol lain" (tombol lain menelan Enter/Spasi
     sendiri lewat `stopPropagation` bawaan <button>).
     --------------------------------------------------------------- */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const onScrubber = scrubRef.current === document.activeElement;
    const key = e.key;

    if (key === " " || key === "k" || key === "K") {
      // Spasi pada sebuah <button> memang harus menekan tombol itu.
      if ((e.target as HTMLElement).tagName === "BUTTON" && key === " ") return;
      e.preventDefault();
      togglePlay();
      keepVisible();
      return;
    }
    if (key === "m" || key === "M") {
      e.preventDefault();
      toggleMute();
      keepVisible();
      return;
    }
    if (key === "f" || key === "F") {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      e.preventDefault();
      if (onScrubber) {
        // HANYA saat scrubber memegang fokus: ± 5 detik.
        seekBy(key === "ArrowLeft" ? -SEEK_STEP : SEEK_STEP);
      } else if (key === "ArrowLeft") {
        onPrevFile?.();
      } else {
        onNextFile?.();
      }
      keepVisible();
      return;
    }
    if (onScrubber && (key === "Home" || key === "End")) {
      e.preventDefault();
      seekTo(key === "Home" ? 0 : 1);
      keepVisible();
    }
  };

  /* ---------------------------------------------------------------
     Geser kiri/kanan DI LUAR scrubber = pindah file.
     Ketuk dua kali TIDAK dipakai di mana pun.
     --------------------------------------------------------------- */
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    keepVisible();
    if (scrubRef.current?.contains(e.target as Node)) {
      touchStart.current = null;
      return;
    }
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) onPrevFile?.();
    else onNextFile?.();
  };

  const ratio = duration > 0 ? Math.min(1, current / duration) : 0;
  const bufferedRatio = duration > 0 ? Math.min(1, buffered / duration) : 0;
  const clockNow = formatClock(current);
  const clockTotal = formatClock(duration);

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${playSize === "sm" ? styles.sm : ""} ${
        controlsHidden ? styles.hidden : ""
      } ${className ?? ""}`}
      style={videoRatio ? ({ "--vp-ratio": String(videoRatio) } as React.CSSProperties) : undefined}
      onKeyDown={onKeyDown}
      onMouseMove={keepVisible}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onFocusCapture={keepVisible}
    >
      {/* `controls` BAWAAN BROWSER TIDAK DIPAKAI — ini kontraknya. */}
      <video
        ref={videoRef}
        className={styles.video}
        src={src}
        poster={poster ?? undefined}
        preload="metadata"
        autoPlay={autoPlay}
        playsInline
        aria-label={label}
        onClick={togglePlay}
        onError={onSourceError}
      />

      <div className={styles.layer}>
        {controlsHidden ? (
          <span className={styles.thin} style={{ width: `${ratio * 100}%` }} aria-hidden="true" />
        ) : null}

        {buffering ? (
          <>
            <span
              className={`${styles.big}`}
              data-state="buffering"
              aria-hidden="true"
            >
              <i className={styles.arc} />
            </span>
            <span className={styles.bufferLabel} role="status">
              Memuat video…
            </span>
          </>
        ) : (
          <button
            type="button"
            className={styles.big}
            data-icon={playing ? "pause" : "play"}
            aria-label={playing ? "Jeda" : "Putar"}
            onClick={togglePlay}
          >
            {playing ? PauseIcon : PlayIcon}
          </button>
        )}

        <div className={styles.bar}>
          <div
            ref={scrubRef}
            role="slider"
            tabIndex={0}
            aria-label="Posisi video"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(current)}
            aria-valuetext={`${clockNow} dari ${clockTotal}`}
            className={`spine-focus-ring--double ${styles.scrub}`}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              seekFromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) seekFromPointer(e.clientX);
            }}
          >
            <span className={styles.track} aria-hidden="true" />
            <span
              className={styles.buffered}
              style={{ width: `${bufferedRatio * 100}%` }}
              aria-hidden="true"
            />
            <span className={styles.fill} style={{ width: `${ratio * 100}%` }} aria-hidden="true" />
            <span className={styles.knob} style={{ left: `${ratio * 100}%` }} aria-hidden="true" />
          </div>

          <div className={styles.row}>
            <div className={styles.left}>
              <span className={styles.time}>
                {clockNow} <span>/ {clockTotal}</span>
              </span>
            </div>
            <div className={styles.right}>
              <button
                type="button"
                className={styles.btn}
                aria-label={muted ? "Nyalakan suara" : "Bisukan"}
                onClick={toggleMute}
              >
                {muted ? MutedIcon : VolumeIcon}
              </button>
              <button
                type="button"
                className={styles.btn}
                aria-label={fullscreen ? "Keluar layar penuh" : "Layar penuh"}
                onClick={toggleFullscreen}
              >
                {fullscreen ? ExitFullscreenIcon : FullscreenIcon}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default VideoPlayer;
