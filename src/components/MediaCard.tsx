import React from "react";
import styles from "./MediaCard.module.css";
import Image from "next/image";

export interface MediaCardProps {
  id: string;
  title: string;
  type: "video" | "image" | "audio" | "document";
  thumbnailUrl: string;
  date: string;
  duration?: string;
  orientation?: "landscape" | "portrait";
  onClick?: (id: string) => void;
  onClickShare?: (id: string, title: string) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string, e: React.MouseEvent) => void;
  onDragStart?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export default function MediaCard({
  id,
  title,
  type,
  thumbnailUrl,
  date,
  duration,
  orientation = "landscape",
  onClick,
  onClickShare,
  isSelected = false,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onContextMenu,
}: MediaCardProps) {
  const isPortrait = orientation === "portrait";

  return (
    <div
      data-card
      data-file-id={id}
      className={`${styles.card} ${isPortrait ? styles.cardPortrait : ""} ${isSelected ? styles.selected : ""}`}
      draggable
      onDragStart={(e) => onDragStart?.(e, id)}
      onDragEnd={(e) => onDragEnd?.(e)}
      onClick={(e) => {
        onClick?.(id);
      }}
      onContextMenu={(e) => onContextMenu?.(e as unknown as React.MouseEvent)}
    >
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={title}
          fill
          className={styles.thumbnail}
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          unoptimized
        />
      ) : (
        <div className={styles.typeWatermark}>
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1">
            {type === "video" && <path d="M8 12l32 12L8 36V12z" fill="currentColor" fillOpacity="0.2" />}
            {type === "image" && <><rect x="6" y="10" width="36" height="28" rx="2" fill="currentColor" fillOpacity="0.1" /><circle cx="17" cy="20" r="4" fill="currentColor" fillOpacity="0.3" /><path d="M6 30l10-8 6 5 4-3 8 6" fill="currentColor" fillOpacity="0.1" /></>}
            {type === "audio" && <><rect x="8" y="10" width="32" height="28" rx="2" fill="currentColor" fillOpacity="0.1" /><circle cx="24" cy="24" r="10" fill="currentColor" fillOpacity="0.2" /><polygon points="21,19 21,29 30,24" fill="currentColor" fillOpacity="0.4" /></>}
            {type === "document" && <><rect x="8" y="6" width="32" height="36" rx="2" fill="currentColor" fillOpacity="0.1" /><path d="M14 16h20M14 22h20M14 28h14" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" /></>}
          </svg>
        </div>
      )}

      <div className={styles.gradientOverlay}></div>

      {onClickShare && (
        <button
          className={styles.shareButton}
          onClick={(e) => {
            e.stopPropagation();
            onClickShare(id, title);
          }}
          title="Share"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
        </button>
      )}

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
        <div className={styles.title}>{title}</div>
        <div className={styles.meta}>
          <span className={styles.typeBadge}>{type}</span>
          <span className={styles.date}>{date}</span>
          {duration && <span className={styles.duration}>{duration}</span>}
        </div>
      </div>
    </div>
  );
}
