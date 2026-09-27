import React from "react";
import styles from "./FolderCard.module.css";
import { formatCount } from "@/lib/format";

export interface FolderCardProps {
  id: string;
  name: string;
  fileCount?: number;
  date?: string;
  isSelected?: boolean;
  variant?: 'folder' | 'folder-root' | 'project';
  coverImage?: string | null;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onClick?: (id: string) => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  /** Story 2.4: kalimat ringkasan isi yang sudah dirakit klien
   *  ("Berisi 1.900 video · 650 foto"). Opsional — kartu lama tanpa
   *  prop ini berperilaku persis seperti sebelumnya. Hari ini kalimat
   *  dibacakan pembaca layar sebagai bagian isi kartu; pemasangannya
   *  sebagai aria-describedby pada tautan tunggal kartu adalah kontrak
   *  Story 2.6 (Kartu Project), bukan story ini. */
  contentSummary?: string;
}

export default function FolderCard({
  id,
  name,
  fileCount = 0,
  date,
  isSelected = false,
  variant = 'folder',
  coverImage,
  onToggleSelect,
  onClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver = false,
  onContextMenu,
  contentSummary,
}: FolderCardProps) {
  const isProject = variant === 'project';
  const isRoot = variant === 'folder-root';
  return (
    <div
      data-card
      data-folder-id={id}
      className={`${styles.card} ${isProject ? styles.projectCard : ""} ${isRoot ? styles.rootCard : ""} ${isSelected ? styles.selected : ""} ${isDragOver ? styles.dragOver : ""}`}
      draggable
      onDragStart={(e) => onDragStart?.(e, id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver?.(e); }}
      onDrop={(e) => { e.preventDefault(); onDrop?.(e, id); }}
      onDragEnd={(e) => onDragEnd?.(e)}
      onContextMenu={(e) => onContextMenu?.(e as unknown as React.MouseEvent)}
      onClick={() => onClick?.(id)}
      style={isProject && coverImage ? {
        backgroundImage: `linear-gradient(180deg, rgba(20,19,16,0.35) 0%, rgba(20,19,16,0.85) 70%, rgba(20,19,16,0.98) 100%), url(${coverImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      } : undefined}
    >
      {isProject && <div className={styles.projectBadge}>PROJECT</div>}
      {isRoot && <div className={styles.rootBadge}>SECTION</div>}

      <div className={styles.iconContainer}>
        {isProject ? (
          // Movie clapboard
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 7h18v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z" />
            <path d="M3 7l2-4h14l2 4" />
            <path d="M7 3l2 4M12 3l2 4M17 3l2 4" />
          </svg>
        ) : isRoot ? (
          // Open folder
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7z" />
            <path d="M3 10h18l-2 9a2 2 0 0 1-2 1.5H5a2 2 0 0 1-2-1.5l0-9z" />
          </svg>
        ) : (
          // Folder
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </div>

      {onToggleSelect && (
        <div
          className={`${styles.checkbox} ${isSelected ? styles.checkboxActive : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(id, e as unknown as React.MouseEvent);
          }}
        >
          {isSelected && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      )}

      <div className={styles.cardContent}>
        <div className={styles.title}>{name}</div>
        <div className={styles.meta}>
          {/* Story 2.6: meta kartu memakai format Indonesia dari
              src/lib/format.ts — "2.600 file · 12 Jan 2026", bukan
              "2600 FILES • 1/12/2026". Pemanggil mengirim `date` yang
              sudah diformat formatDate(). */}
          {formatCount(fileCount, "file")}
          {date ? ` · ${date}` : ""}
        </div>
        {contentSummary && (
          <span className="spine-visually-hidden">{contentSummary}</span>
        )}
      </div>
    </div>
  );
}
