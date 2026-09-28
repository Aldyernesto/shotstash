"use client";

import React from "react";
import styles from "./FileCard.module.css";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/useFormat";
import SelectCheck from "./SelectCheck";
import MoreButton from "./MoreButton";

export type FileKind = "image" | "video" | "audio" | "document";

export type FileCardProps = {
  id: string;
  name: string;
  kind: FileKind;
  sizeBytes: number;
  thumbnailUrl?: string | null;
  /** "02:47" bila diketahui; kolom durasi belum ada di database. */
  duration?: string | null;
  isSelected?: boolean;
  /** Story 2.12: mode pilih sentuh — ketuk kartu MEMILIH, bukan membuka. */
  selectMode?: boolean;
  /** Story 2.12: ada ≥ 1 item terpilih di halaman → centang selalu tampil. */
  anySelected?: boolean;
  onOpen: (id: string) => void;
  onShare?: (id: string, name: string) => void;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Story 2.12: tombol "⋯" membuka menu yang sama dengan klik-kanan. */
  onOpenMenu?: (anchor: { x: number; y: number }) => void;
  /** Story 3.3: menu aksi kartu ini terbuka — kartu tetap hover/fokus. */
  menuOpen?: boolean;
  /** Story 2.17: hanya role yang boleh memindahkan yang bisa menyeret kartu. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;
};

function extensionOf(name: string): string {
  const ext = (name.split(".").pop() || "").trim();
  return ext && ext.length <= 5 ? ext.toUpperCase() : "";
}

/**
 * `file-card` (Story 2.11) — kartu potret 3:4 berbingkai terang dengan
 * nama dan ukuran DI BAWAH foto. Video memakai `video-marker`, dokumen
 * memakai `doc-card`; tidak ada ikon dokumen generik dan tidak ada emoji
 * sebagai penanda jenis di mana pun.
 *
 * Story 2.12 menambahkan `select-check` native dan tombol "⋯" varian
 * `in-caption` sebagai SIBLING DI ATAS tombol kartu.
 */
export default function FileCard({
  id,
  name,
  kind,
  sizeBytes,
  thumbnailUrl,
  duration,
  isSelected = false,
  selectMode = false,
  anySelected = false,
  onOpen,
  onShare,
  onToggleSelect,
  onContextMenu,
  onOpenMenu,
  menuOpen = false,
  draggable = true,
  onDragStart,
  onDragEnd,
}: FileCardProps) {
  const isDoc = kind === "document";
  const isVideo = kind === "video";
  const t = useTranslations("cards");
  const f = useFormat();
  const sizeText = f.fileSize(Number(sizeBytes) || 0);
  const ext = extensionOf(name);
  // "{nama file}, {jenis}, {ukuran}" (+ durasi untuk video)
  const kindText = t(`kind.${kind}`);
  const accessibleName =
    isVideo && duration
      ? t("fileNameDuration", { name, kind: kindText, size: sizeText, duration })
      : t("fileName", { name, kind: kindText, size: sizeText });

  return (
    <article
      className={`${styles.cell} ${isSelected ? styles.selected : ""}`}
      data-card
      data-file-id={id}
      data-select-mode={selectMode ? "" : undefined}
      data-menu-open={menuOpen || undefined}
      data-any-selected={anySelected ? "" : undefined}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, id)}
      onDragEnd={(e) => onDragEnd?.(e)}
      onContextMenu={onContextMenu}
    >
      <div className={styles.photo} aria-hidden="true">
        {isDoc ? (
          <span className={styles.doc}>
            <span className={styles.docSheet} />
            {ext ? <span className={`spine-display-sticker ${styles.docExt}`}>{ext}</span> : null}
          </span>
        ) : thumbnailUrl ? (
          /* alt="" karena namanya sudah tertulis di bawah foto. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={styles.thumb}
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : null}

        {isVideo ? (
          /* Video yang frame thumbnail-nya belum dibuat tetap menampilkan
             placeholder BESERTA video-marker. */
          <span className={`spine-tag-mobile ${styles.videoMarker}`}>
            <svg viewBox="0 0 9 10" aria-hidden="true">
              <path d="M0 0l9 5-9 5z" />
            </svg>
            {duration}
          </span>
        ) : null}
      </div>

      {/* Tepat SATU kontrol pembuka, direntangkan seluas kartu. Di mode
          pilih sentuh, ketukannya MEMILIH kartu alih-alih membukanya. */}
      <button
        type="button"
        className={styles.open}
        aria-label={accessibleName}
        onClick={(e) => {
          if (selectMode && onToggleSelect) {
            e.preventDefault();
            onToggleSelect(id, e as unknown as React.MouseEvent);
            return;
          }
          onOpen(id);
        }}
      />

      {/* Nama & ukuran DI BAWAH foto; "⋯" di ujung baris nama dan berada
          DI ATAS tombol kartu, jadi menekannya tidak membuka file. */}
      <div className={styles.caption}>
        <div className={styles.captionText}>
          <span className={`spine-chip ${styles.name}`} title={name} aria-hidden="true">
            {name}
          </span>
          <span className={`spine-chip ${styles.size}`} aria-hidden="true">
            {sizeText}
          </span>
        </div>
        {onOpenMenu ? (
          <MoreButton
            itemName={name}
            variant="in-caption"
            className={styles.moreButton}
            expanded={menuOpen}
            onOpen={onOpenMenu}
          />
        ) : null}
      </div>

      {onToggleSelect ? (
        <SelectCheck
          itemName={name}
          checked={isSelected}
          variant="on-photo"
          className={styles.selectCheck}
          onToggle={(e) => onToggleSelect(id, e as unknown as React.MouseEvent)}
        />
      ) : null}

      {onShare ? (
        <button
          type="button"
          className={`spine-focus-ring ${styles.shareButton}`}
          aria-label={t("share", { name })}
          onClick={(e) => {
            e.stopPropagation();
            onShare(id, name);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
        </button>
      ) : null}
    </article>
  );
}
