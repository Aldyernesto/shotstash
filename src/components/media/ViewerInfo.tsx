"use client";

/**
 * Story 3.6 — `viewer-info-panel` (desktop) & `viewer-info-sheet` (HP).
 *
 * Ini SATU-SATUNYA bagian `file-viewer` yang ikut tema; lapisan di
 * sekelilingnya tetap gelap di dua tema.
 *
 * Aturan keras `<dl>`:
 *  - Urutan SELALU sama: Tipe · Ukuran · Dimensi · Diambil · Diunggah ·
 *    Project · Section. Baris tanpa nilai TETAP DIRENDER dengan "—"
 *    (bukan dihapus), didampingi teks tersembunyi-visual "Tidak ada"
 *    supaya pembaca layar membaca "Diambil, Tidak ada", bukan "strip".
 *  - "Diambil" berasal dari EXIF kamera yang TIDAK menyimpan zona waktu:
 *    ditulis APA ADANYA + "(waktu kamera)", tidak pernah dikonversi ke
 *    WIB. Nilai yang tidak bisa diurai diperlakukan sama dengan kosong —
 *    tidak pernah ditampilkan mentah dan tidak pernah ditebak, dan
 *    keterangan "(waktu kamera)" tidak ikut dirender saat kosong.
 *  - "Diunggah" memakai WIB dengan format Indonesia.
 *  - Metadata kosong TIDAK PERNAH memunculkan pesan error di layar;
 *    kegagalan membacanya dicatat ke konsol.
 *
 * Lembar HP adalah `<section>` DI DALAM `role="dialog"` viewer — bukan
 * dialog kedua — sehingga aturan satu lapisan modal tetap terjaga.
 */

import React, { useEffect, useRef, useState } from "react";
import styles from "./viewerInfo.module.css";
import { formatDateTimeWIB, formatDimensions, formatExifCameraTime, formatFileSize } from "@/lib/format";
import { parseSectionName } from "@/lib/sectionNumber";

export type ViewerInfoFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size?: number | string | null;
  createdAt?: string | number | Date | null;
  /** Lebar × tinggi TAMPIL (sudah dikoreksi rotasi). Skema tidak
      menyimpannya; `FileViewer` mengisinya dari elemen media yang sedang
      terbuka (videoWidth/videoHeight, naturalWidth/naturalHeight). */
  width?: number | null;
  height?: number | null;
  /** String EXIF MENTAH dari kamera. Jangan pernah oper `Date` ke sini. */
  capturedAtRaw?: string | null;
  /** Durasi video "02:18" bila diketahui. */
  duration?: string | null;
};

export type ViewerInfoProps = {
  variant: "panel" | "sheet";
  file: ViewerInfoFile;
  projectTitle?: string | null;
  sectionName?: string | null;
  onClose: () => void;
};

const CloseIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const ChevronUpIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 14.5l6-6 6 6" />
  </svg>
);
const PhotoIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M3 16l5-5 4 4 3-3 6 6" />
    <circle cx="8.5" cy="9.5" r="1.4" />
  </svg>
);
const FilmIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M8 5v14M16 5v14M3 12h18" />
  </svg>
);

/** Nilai kosong: "—" + teks tersembunyi-visual "Tidak ada". */
const NONE = (
  <>
    <span aria-hidden="true">—</span>
    <span className="spine-visually-hidden">Tidak ada</span>
  </>
);

function typeLabel(mime: string, name: string, duration?: string | null): React.ReactNode {
  const ext = (name.split(".").pop() || "").toUpperCase();
  const base = ext && ext.length <= 5 ? ext : mime.split("/").pop()?.toUpperCase() || "";
  if (!base) return NONE;
  return duration ? `${base} · ${duration}` : base;
}

/**
 * EXIF apa adanya. Nilai yang bukan string bermakna (kosong, spasi, atau
 * hanya tanda baca) diperlakukan sebagai TIDAK ADA — tidak ditebak dan
 * tidak ditampilkan mentah.
 */
function capturedValue(raw?: string | null): React.ReactNode {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || !/\d/.test(text)) {
    if (raw) {
      // Bukan ke layar: kegagalan membaca metadata dicatat ke konsol.
      console.warn("[viewer-info] nilai EXIF 'Diambil' tidak bisa diurai:", raw);
    }
    return NONE;
  }
  return formatExifCameraTime(text);
}

export function ViewerInfo({ variant, file, projectTitle, sectionName, onClose }: ViewerInfoProps) {
  const isVideo = file.mimeType.startsWith("video/");
  /** Lembar HP punya DUA tinggi: intip 300px dan penuh (maks 85%). */
  const [height, setHeight] = useState<"peek" | "full">("peek");
  const titleRef = useRef<HTMLParagraphElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const touch = useRef<number | null>(null);

  // Fokus pindah ke judul lembar saat dibuka; kembalinya ke ⓘ diurus
  // pemanggil (`FileViewer`).
  useEffect(() => {
    if (variant !== "sheet") return;
    titleRef.current?.focus({ preventScroll: true });
  }, [variant]);

  // "2160 × 3840 px · Potret (9:16)" — orientasi + rasio umum ikut ditulis
  // karena itulah yang dicari editor (klip 9:16 untuk Reels), bukan angkanya.
  const dimensions =
    file.width && file.height
      ? formatDimensions(file.width, file.height)
      : NONE;

  const rows: [string, React.ReactNode][] = [
    ["Tipe", typeLabel(file.mimeType, file.originalName, file.duration)],
    ["Ukuran", file.size != null ? formatFileSize(Number(file.size)) : NONE],
    ["Dimensi", dimensions],
    ["Diambil", capturedValue(file.capturedAtRaw)],
    ["Diunggah", file.createdAt ? formatDateTimeWIB(file.createdAt) : NONE],
  ];

  const section = sectionName ? parseSectionName(sectionName) : null;

  const body = (
    <>
      <p ref={titleRef} tabIndex={-1} className={`spine-display-card ${styles.fileName}`}>
        {file.originalName}
      </p>
      <dl className={styles.dl}>
        {rows.map(([dt, dd]) => (
          <React.Fragment key={dt}>
            <dt>{dt}</dt>
            <dd>{dd}</dd>
          </React.Fragment>
        ))}
      </dl>
      <hr className={styles.rule} />
      <dl className={styles.dl}>
        <dt>Project</dt>
        <dd>{projectTitle || NONE}</dd>
        <dt>Section</dt>
        <dd>
          {section ? (
            <span className={styles.location}>
              {section.number ? (
                /* Stiker nomor tetap blok kuning berteks ink di KEDUA tema. */
                <span className={`spine-display-label ${styles.numberSticker}`}>
                  <span aria-hidden="true">NO</span>
                  <span className="spine-visually-hidden">Nomor</span> {section.number}
                </span>
              ) : null}
              <b className={styles.sectionName}>{section.title}</b>
            </span>
          ) : (
            NONE
          )}
        </dd>
      </dl>
    </>
  );

  const head = (
    <div className={styles.head}>
      <span className={`spine-label ${styles.headLabel}`}>
        Info file
        <span className={styles.kindChip}>
          {isVideo ? FilmIcon : PhotoIcon}
          {isVideo ? "Video" : "Foto"}
        </span>
      </span>
      <button
        type="button"
        className={`spine-focus-ring ${styles.close}`}
        aria-label="Tutup info"
        onClick={onClose}
      >
        {CloseIcon}
      </button>
    </div>
  );

  if (variant === "panel") {
    return (
      <section aria-label="Info file" className={styles.panel}>
        {head}
        {body}
      </section>
    );
  }

  /* -------------------- lembar HP -------------------- */
  return (
    <>
      {height === "full" ? <div className={styles.dim} aria-hidden="true" /> : null}
      <section
        ref={sheetRef}
        aria-label="Info file"
        className={`${styles.sheet} ${height === "peek" ? styles.peek : styles.full}`}
        onTouchStart={(e) => {
          touch.current = e.touches[0].clientY;
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (start == null) return;
          const dy = e.changedTouches[0].clientY - start;
          // Tarik gagang ke BAWAH: penuh → intip → tutup.
          if (dy > 48) {
            if (height === "full") setHeight("peek");
            else onClose();
          } else if (dy < -48) {
            setHeight("full");
          }
        }}
      >
        {/* Gagang adalah TOMBOL 96 × 28 px — gestur tarik bukan
            satu-satunya jalan (area sentuh 48px lewat `hit-area`). */}
        <button
          type="button"
          className={`spine-focus-ring spine-hit-area ${styles.grab}`}
          aria-label={height === "peek" ? "Perbesar info" : "Perkecil info"}
          onClick={() => setHeight((h) => (h === "peek" ? "full" : "peek"))}
        >
          <i aria-hidden="true" />
        </button>
        {head}
        {body}
        {height === "peek" ? (
          <button
            type="button"
            className={`spine-focus-ring ${styles.more}`}
            onClick={() => setHeight("full")}
          >
            {ChevronUpIcon}
            Tampilkan semua info
          </button>
        ) : null}
      </section>
    </>
  );
}
