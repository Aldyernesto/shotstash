"use client";

import React from "react";
import styles from "./SectionCard.module.css";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/useFormat";
import { parseSectionName } from "@/lib/sectionNumber";
import type { ContentSummary } from "@/lib/contentSummary";
import { PillButton } from "@/components/form/buttons";
import SelectCheck from "./SelectCheck";
import MoreButton from "./MoreButton";
import type { RepFile } from "./ProjectCard";

export type SectionCardProps = {
  id: string;
  /** Nama Section apa adanya, mis. "11. Musium Khairul Kholq". */
  name: string;
  totalFiles: number;
  contentSummary?: ContentSummary | null;
  /** `folder.repFiles(limit: 3)` — 1 kartu depan + 2 kartu belakang. */
  repFiles?: RepFile[] | null;
  isSelected?: boolean;
  isDragOver?: boolean;
  /** Story 2.17: teks chip `drag-over` — tujuan drop ditulis, bukan diwarnai. */
  dragOverLabel?: string | null;
  canUpload?: boolean;
  /** Story 2.12: mode pilih sentuh — ketuk kartu MEMILIH, bukan membuka. */
  selectMode?: boolean;
  /** Story 2.12: ada ≥ 1 item terpilih di halaman → centang selalu tampil. */
  anySelected?: boolean;
  onOpen: (id: string) => void;
  onUploadFirst?: (id: string) => void;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Story 2.12: tombol "⋯" membuka menu yang sama dengan klik-kanan. */
  onOpenMenu?: (anchor: { x: number; y: number }) => void;
  /** Story 3.3: menu aksi kartu ini terbuka — kartu tetap hover/fokus. */
  menuOpen?: boolean;
  /** Story 2.17: kartu hanya bisa diseret oleh role yang boleh memindahkan. */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  /** Story 2.17: pemanggil yang memutuskan `preventDefault` (dan sorotan). */
  onDragOver?: (e: React.DragEvent, id: string) => void;
  onDragLeave?: (e: React.DragEvent, id: string) => void;
  onDrop?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;
};

function thumbStyle(file?: RepFile): React.CSSProperties | undefined {
  // Thumbnail belum siap -> {colors.rep-placeholder} dari CSS; kartunya
  // tetap dirender.
  if (!file?.thumbnailUrl) return undefined;
  return { backgroundImage: `url(${file.thumbnailUrl})` };
}

/**
 * Kartu Section (Story 2.10) — tumpukan tiga kartu bernomor yang
 * memperlihatkan cuplikan isi Section itu sendiri. TIDAK ADA garis aksen
 * kiri, chip "SECTION", atau ikon folder generik di mana pun.
 */
export default function SectionCard({
  id,
  name,
  totalFiles,
  contentSummary,
  repFiles,
  isSelected = false,
  isDragOver = false,
  dragOverLabel = null,
  canUpload = false,
  selectMode = false,
  anySelected = false,
  onOpen,
  onUploadFirst,
  onToggleSelect,
  onContextMenu,
  onOpenMenu,
  menuOpen = false,
  draggable = true,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: SectionCardProps) {
  const t = useTranslations("cards");
  const tc = useTranslations("common");
  const tCount = useTranslations("count");
  const f = useFormat();
  const { number, title } = parseSectionName(name);
  const sample = (repFiles ?? []).slice(0, 3);
  const isEmpty = (totalFiles || 0) === 0;
  const showUploadCta = isEmpty && canUpload && !!onUploadFirst;
  const count = totalFiles || 0;
  const countText = tCount("files", { count });
  const summarySentence = f.contentSentence(contentSummary);
  const summaryId = `section-summary-${id}`;
  const accessibleName = number
    ? t("sectionNameNumbered", { number, title, files: countText })
    : t("sectionName", { title, files: countText });

  return (
    <article
      className={`${styles.cell} ${isDragOver ? styles.dragOver : ""}`}
      data-card
      data-folder-id={id}
      data-select-mode={selectMode ? "" : undefined}
      data-menu-open={menuOpen || undefined}
      data-any-selected={anySelected ? "" : undefined}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, id)}
      onDragOver={(e) => onDragOver?.(e, id)}
      onDragLeave={(e) => onDragLeave?.(e, id)}
      onDrop={(e) => onDrop?.(e, id)}
      onDragEnd={(e) => onDragEnd?.(e)}
      onContextMenu={onContextMenu}
    >
      <div className={styles.stack}>
        <div
          className={`${styles.backCard} ${styles.back1}`}
          aria-hidden="true"
          style={thumbStyle(sample[1])}
        />
        <div
          className={`${styles.backCard} ${styles.back2}`}
          aria-hidden="true"
          style={thumbStyle(sample[2])}
        />
        <div
          className={`${styles.frontCard} ${isEmpty ? styles.frontEmpty : ""}`}
          aria-hidden="true"
          style={isEmpty ? undefined : thumbStyle(sample[0])}
        >
          <span className={`spine-display-card ${styles.title}`}>{title}</span>
          {isEmpty ? (
            <span className={`spine-label ${styles.emptyHint}`}>
              {canUpload ? t("emptyDropHint") : t("empty")}
            </span>
          ) : null}
        </div>

        {number ? (
          <span className={`spine-display-label ${styles.numberSticker}`}>
            <span className={styles.numberPrefix} aria-hidden="true">
              {tc("numberPrefix")}
            </span>
            <span className="spine-visually-hidden">{tc("number")}</span> {number}
          </span>
        ) : null}
      </div>

      <span className={`spine-chip ${styles.countChip}`} aria-hidden="true">
        {/* Kotak pelat, BUKAN ikon folder — AC 2.10 melarang ikon folder
            generik di mana pun pada kartu (bentuk sama dengan mock). */}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="3" />
        </svg>
        {countText}
      </span>

      {/* Tepat SATU tautan; `::after`-nya seluas kartu. */}
      <a
        className={styles.link}
        href={`/dashboard?f=${encodeURIComponent(id)}`}
        title={title}
        aria-describedby={summarySentence ? summaryId : undefined}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          // Mode pilih sentuh: ketuk kartu MEMILIH kartu itu (AC 2.12).
          if (selectMode && onToggleSelect) {
            onToggleSelect(id, e as unknown as React.MouseEvent);
            return;
          }
          onOpen(id);
        }}
      >
        <span className="spine-visually-hidden">{accessibleName}</span>
      </a>

      {/* select-check, "⋯", dan CTA adalah SIBLING DI ATAS tautan, tidak
          pernah anaknya — menekannya tidak ikut membuka Section. */}
      {onToggleSelect ? (
        <SelectCheck
          itemName={title}
          checked={isSelected}
          variant="on-photo"
          className={styles.selectCheck}
          onToggle={(e) => onToggleSelect(id, e as unknown as React.MouseEvent)}
        />
      ) : null}

      {onOpenMenu ? (
        <MoreButton
          itemName={title}
          variant="object"
          className={styles.moreButton}
          expanded={menuOpen}
          onOpen={onOpenMenu}
        />
      ) : null}

      {/* Story 2.17: chip tujuan — sorotan seret TIDAK PERNAH warna saja. */}
      {isDragOver && dragOverLabel ? (
        <span className={`spine-nav ${styles.dragChip}`} role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
          </svg>
          {dragOverLabel}
        </span>
      ) : null}

      {showUploadCta ? (
        <PillButton
          variant="accent"
          className={styles.uploadCta}
          onClick={(e) => {
            e.stopPropagation();
            onUploadFirst?.(id);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
            <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
          </svg>
          {t("uploadFirst")}
        </PillButton>
      ) : null}

      {summarySentence ? (
        <p id={summaryId} className="spine-visually-hidden">
          {summarySentence}
        </p>
      ) : null}
    </article>
  );
}
