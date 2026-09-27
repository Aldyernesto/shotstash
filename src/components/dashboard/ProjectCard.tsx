"use client";

import React from "react";
import styles from "./ProjectCard.module.css";
import { fanLayout, FAN_MAX, FAN_STAGGER_MS, type FanSlot } from "./projectCardGeometry";
import { formatDate, formatNumber } from "@/lib/format";
import { describeContentSummary, type ContentSummary } from "@/lib/contentSummary";
import { PillButton } from "@/components/form/buttons";
import MoreButton from "./MoreButton";
import { useShellLayers } from "./project3d/useShellLayers";

/** Bentuk `RepFile` dari skema GraphQL Story 2.4. */
export type RepFile = {
  id: string;
  kind: string;
  thumbnailUrl?: string | null;
  duration?: number | null;
  extension?: string | null;
};

export type ProjectCardProps = {
  id: string;
  title: string;
  /** TOTAL file project — yang tampil di `count-sticker`. */
  totalFiles: number;
  createdAt: string | number | Date;
  /** Angka mentah `contentSummary` (Story 2.4); kalimatnya dirakit di sini. */
  contentSummary?: ContentSummary | null;
  /** Sampel harian `repFiles(limit: 5)`; maksimum 5 dipakai. */
  repFiles?: RepFile[] | null;
  onOpen: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /**
   * Story 2.12: tombol "⋯" membuka menu yang sama dengan klik-kanan.
   * Kartu Project TIDAK PERNAH mendapat `select-check` — tingkat Projects
   * memang tidak bisa dipilih-banyak.
   */
  onOpenMenu?: (anchor: { x: number; y: number }) => void;
  /**
   * Story 3.3: menu aksi kartu ini sedang terbuka — kartu TETAP dalam
   * keadaan hover/fokus (kipas tetap terbuka, "⋯" tetap tampil) selama
   * menu terbuka, dan "⋯" melaporkan `aria-expanded`.
   */
  menuOpen?: boolean;
  /**
   * Story 2.8: hanya role yang boleh upload (SUPER_ADMIN, ADMIN,
   * FIELD_CREW) yang melihat CTA "Upload footage pertama" dan kalimat
   * "seret file ke sini"; role lain melihat "Masih kosong" saja.
   */
  canUpload?: boolean;
  /** Membuka jalur upload yang ADA SEKARANG dengan Project ini sebagai lingkup. */
  onUploadFirst?: (id: string) => void;
};

/** Durasi "02:47" dari detik; null → tanpa teks (kolomnya belum ada di DB). */
function formatDuration(seconds?: number | null): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 9 10" aria-hidden="true">
      <path d="M0 0l9 5-9 5z" />
    </svg>
  );
}

/**
 * Satu `rep-card` di dalam kipas. SELALU `aria-hidden` (AC 2.6):
 * ringkasan isi kartu datang dari `contentSummary`, tidak pernah dari
 * nama file. Video mendapat `video-marker`, dokumen jadi `doc-card`
 * mini — tidak ada ikon folder atau emoji sebagai penanda jenis.
 */
function RepCard({ file, slot, delayMs }: { file: RepFile; slot: FanSlot; delayMs: number }) {
  const isDoc = file.kind === "document";
  const isVideo = file.kind === "video";
  const duration = formatDuration(file.duration);
  return (
    <div
      className={styles.repCard}
      aria-hidden="true"
      style={
        {
          // fan-rest
          "--x": slot.x,
          "--r": `${slot.r}deg`,
          // fan-open (Story 2.7)
          "--hx": slot.hx,
          "--hy": slot.hy,
          "--hr": `${slot.hr}deg`,
          // {motion.fan-stagger}
          "--d": `${delayMs}ms`,
        } as React.CSSProperties
      }
    >
      {isDoc ? (
        <span className={styles.repDoc}>
          <span className={styles.repDocSheet} />
          {file.extension ? (
            <span className={`spine-display-sticker ${styles.repDocExt}`}>{file.extension}</span>
          ) : null}
        </span>
      ) : file.thumbnailUrl ? (
        /* Anggaran byte Story 2.6: ≤ 30 KB per thumbnail perwakilan.
           lazy + async wajib supaya grid 1280 px tetap ≤ 600 KB. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.repThumb}
          src={file.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      ) : null}
      {isVideo ? (
        <span className={`spine-tag-mobile ${styles.repVideo}`}>
          <PlayGlyph />
          {duration}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Kartu Project (Story 2.6) — objek saku berlapis berisi cuplikan isi
 * project itu sendiri. Kontrak aksesibilitas:
 *   • `<article>` berisi TEPAT SATU tautan;
 *   • `::after` tautan direntangkan seluas kartu dan membawa focus-ring;
 *   • nama aksesibel "{nama}, {n} file, {tanggal}", `aria-describedby`
 *     menunjuk kalimat ringkasan isi dari `contentSummary`;
 *   • TIDAK ADA `select-check` di tingkat Projects (tidak bisa pilih-banyak).
 */
export default function ProjectCard({
  id,
  title,
  totalFiles,
  createdAt,
  contentSummary,
  repFiles,
  onOpen,
  onContextMenu,
  onOpenMenu,
  menuOpen = false,
  canUpload = false,
  onUploadFirst,
}: ProjectCardProps) {
  // Story 2.7 — keadaan kipas. "auto" = hover/fokus CSS yang memutuskan;
  // "open" = kipas otomatis sekali di perangkat sentuh; "closed" = Esc
  // menutup kipas SEMENTARA FOKUS TETAP DI KARTU.
  const objectRef = React.useRef<HTMLDivElement>(null);
  const [fanState, setFanState] = React.useState<"auto" | "open" | "closed">("auto");

  React.useEffect(() => {
    const el = objectRef.current;
    if (!el || typeof window === "undefined") return;
    // Mode kalem: kipas otomatis TIDAK PERNAH berjalan. Kill-switch CSS
    // hanya menjepit durasi; IntersectionObserver harus dicegat di sini.
    if (document.documentElement.dataset.motion === "calm") return;
    // Hanya perangkat tanpa hover — di desktop kipas dibuka kursor/fokus.
    if (!window.matchMedia?.("(hover: none)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect(); // sekali per kartu per kunjungan halaman
        setFanState((s) => (s === "auto" ? "open" : s));
        timer = window.setTimeout(() => setFanState((s) => (s === "open" ? "auto" : s)), 1400);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // Story 2.9 — lapisan objek 3D bersama. `null` = jalur gambar diam
  // (belum dimuat, WebGL tidak ada, context hilang, mode kalem, atau GLB
  // gagal); kartu lalu memakai lapisan CSS Story 2.6 apa adanya.
  const shell = useShellLayers(objectRef);

  const sample = (repFiles ?? []).slice(0, FAN_MAX);
  const slots = fanLayout(sample.length || 1);
  // Story 2.8: Project 0 file -> kipas diganti SATU slot hantu.
  const isEmpty = (totalFiles || 0) === 0;
  const showUploadCta = isEmpty && canUpload && !!onUploadFirst;
  const dateText = formatDate(createdAt);
  const countText = formatNumber(totalFiles || 0);
  const summarySentence = describeContentSummary(contentSummary);
  const summaryId = `project-summary-${id}`;
  const accessibleName = `${title}, ${countText} file, ${dateText}`;

  return (
    <article
      className={styles.cell}
      data-card
      data-folder-id={id}
      data-menu-open={menuOpen || undefined}
      onContextMenu={onContextMenu}
    >
      <div
        ref={objectRef}
        className={styles.object}
        data-fan={menuOpen ? "open" : fanState === "auto" ? undefined : fanState}
        data-shell={shell ? "3d" : undefined}
        onKeyDown={(e) => {
          // Esc menutup kipas; fokus sengaja TIDAK dipindahkan.
          if (e.key === "Escape" && fanState !== "closed") {
            e.stopPropagation();
            setFanState("closed");
          }
        }}
        onMouseLeave={() => setFanState("auto")}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFanState("auto");
        }}
      >
        <div className={styles.stage}>
          <div className={styles.back} aria-hidden="true" />
          {shell ? (
            <div
              className={styles.shellBack}
              aria-hidden="true"
              style={{ backgroundImage: `url(${shell.back})` }}
            />
          ) : null}

          {isEmpty ? <div className={styles.ghostSlot} aria-hidden="true" /> : null}

          <div className={styles.fan} aria-hidden="true">
            {sample.map((file, i) => (
              <RepCard
                key={file.id}
                file={file}
                slot={slots[i] ?? slots[slots.length - 1]}
                delayMs={FAN_STAGGER_MS[i] ?? FAN_STAGGER_MS[FAN_STAGGER_MS.length - 1]}
              />
            ))}
          </div>

          <span className={`spine-display-sticker ${styles.countSticker}`} aria-hidden="true">
            {countText}
            <span className={`spine-sticker-unit ${styles.countUnit}`}>file</span>
          </span>

          {shell ? (
            <div
              className={styles.shellFront}
              aria-hidden="true"
              style={{ backgroundImage: `url(${shell.front})` }}
            />
          ) : null}

          <div className={`${styles.pocket} ${isEmpty ? styles.pocketEmpty : ""}`}>
            <span className={styles.labelPill}>
              <a
                className={`spine-display-label ${styles.link}`}
                href={`/dashboard?p=${encodeURIComponent(id)}`}
                title={title}
                aria-describedby={summarySentence ? summaryId : undefined}
                onClick={(e) => {
                  // Satu klik membuka Project tanpa menunggu animasi.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpen(id);
                }}
              >
                <span className="spine-visually-hidden">{accessibleName}</span>
                <span className={styles.linkText} aria-hidden="true">
                  {title}
                </span>
              </a>
            </span>
            {isEmpty ? (
              <span className={`spine-label ${styles.emptyHint}`} aria-hidden="true">
                {canUpload ? "Masih kosong — seret file ke sini" : "Masih kosong"}
              </span>
            ) : (
              <span className={`spine-label ${styles.date}`} aria-hidden="true">
                {dateText}
              </span>
            )}
          </div>

          {/* CTA adalah SIBLING DI ATAS tautan (z-index 5 > ::after
              tautan), jadi menekannya tidak pernah ikut membuka
              Project di belakangnya. */}
          {showUploadCta ? (
            <PillButton
              variant="yellow"
              className={styles.uploadCta}
              onClick={(e) => {
                e.stopPropagation();
                onUploadFirst?.(id);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
              </svg>
              Upload footage pertama
            </PillButton>
          ) : null}
        </div>
      </div>

      {/* Story 2.12: "⋯" adalah SIBLING DI ATAS tautan kartu. Kartu Project
          tidak punya `select-check` — tingkat ini tidak bisa dipilih-banyak. */}
      {onOpenMenu ? (
        <MoreButton
          itemName={title}
          variant="object"
          expanded={menuOpen}
          className={styles.moreButton}
          onOpen={onOpenMenu}
        />
      ) : null}

      {summarySentence ? (
        <p id={summaryId} className="spine-visually-hidden">
          {summarySentence}
        </p>
      ) : null}
    </article>
  );
}

/**
 * Story 2.8 — `project-skeleton`: siluet DIAM keadaan diam Kartu Project
 * (panel belakang + saku + 3 kartu placeholder + pill label kosong).
 * Tanpa shimmer dan tanpa animasi apa pun, di semua mode. Region
 * ber-`aria-busy` dipasang oleh grid pemanggil.
 */
export function ProjectCardSkeleton() {
  const slots = fanLayout(3);
  return (
    <div className={styles.cell} aria-hidden="true">
      <div className={styles.object} data-skeleton="">
        <div className={styles.stage}>
          <div className={styles.back} />
          <div className={styles.fan}>
            {slots.map((slot, i) => (
              <div
                key={i}
                className={`${styles.repCard} ${styles.skeletonRep}`}
                style={{ "--x": slot.x, "--r": `${slot.r}deg` } as React.CSSProperties}
              />
            ))}
          </div>
          <div className={`${styles.pocket} ${styles.skeletonPocket}`}>
            <div className={styles.skeletonLabel} />
          </div>
        </div>
      </div>
    </div>
  );
}
