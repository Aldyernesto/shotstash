"use client";

import React from "react";
import styles from "./ListView.module.css";
import RepThumb from "./RepThumb";
import SelectCheck from "./SelectCheck";
import MoreButton from "./MoreButton";
import { PillButton } from "@/components/form/buttons";
import { EmptyState, SkeletonRow, ErrorBox } from "./states";
import { useTranslations } from "next-intl";
import { useFormat } from "@/i18n/useFormat";
import { parseSectionName } from "@/lib/sectionNumber";
import type { RepFile } from "./ProjectCard";

export type SortField = "name" | "date" | "size" | "type";
export type ListLevel = "projects" | "sections" | "files";

type Anchor = { x: number; y: number };

type ListT = ReturnType<typeof useTranslations<"list">>;

/** Column label keys under `list.column`. */
type ColumnKey =
  | "project"
  | "section"
  | "contents"
  | "date"
  | "actions"
  | "select"
  | "name"
  | "type"
  | "size"
  | "uploadedBy";

/** Satu kolom kepala: label + field urut bersama (null = tidak bisa diurut). */
type Column = { label: ColumnKey; field: SortField | null; hidden?: boolean };

const COLUMNS: Record<ListLevel, Column[]> = {
  // Tingkat Projects TIDAK punya kolom centang — Project tidak bisa
  // dipilih-banyak (perilaku sekarang, AC 2.12 & 2.15).
  projects: [
    { label: "project", field: "name" },
    { label: "contents", field: "size" },
    { label: "date", field: "date" },
    { label: "actions", field: null, hidden: true },
  ],
  sections: [
    { label: "select", field: null, hidden: true },
    { label: "section", field: "name" },
    { label: "contents", field: "size" },
    { label: "date", field: "date" },
    { label: "actions", field: null, hidden: true },
  ],
  files: [
    { label: "select", field: null, hidden: true },
    { label: "name", field: "name" },
    { label: "type", field: "type" },
    { label: "size", field: "size" },
    { label: "date", field: "date" },
    // Skema hanya menyimpan `MediaFile.uploadedBy` tanpa indeks urut
    // bersama; kolom ini dijelaskan di laporan sebagai perbedaan mock.
    { label: "uploadedBy", field: null },
    { label: "actions", field: null, hidden: true },
  ],
};

/**
 * Sort field -> message key under `list.column`; translate at render,
 * e.g. `useTranslations("list.column")(SORT_LABEL[field])`.
 */
const SORT_LABEL: Record<SortField, ColumnKey> = {
  name: "name",
  date: "date",
  size: "size",
  type: "type",
};

function CaretIcon({ asc }: { asc: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={asc ? "M7 14l5-5 5 5" : "M7 10l5 5 5-5"} />
    </svg>
  );
}

function ListHead({
  level,
  sortBy,
  sortAsc,
  onSort,
}: {
  level: ListLevel;
  sortBy: SortField;
  sortAsc: boolean;
  onSort: (field: SortField) => void;
}) {
  const t = useTranslations("list.column");
  return (
    <div className={`${styles.head} ${styles[level]}`} role="row">
      {COLUMNS[level].map((col) => {
        if (col.field === null) {
          // Kolom aksi & kolom centang: BUKAN tombol dan TANPA aria-sort.
          return (
            <span key={col.label} role="columnheader">
              {col.hidden ? (
                <span className="spine-visually-hidden">{t(col.label)}</span>
              ) : (
                <span className={styles.headLabel}>{t(col.label)}</span>
              )}
            </span>
          );
        }
        const active = sortBy === col.field;
        return (
          <span
            key={col.label}
            role="columnheader"
            aria-sort={active ? (sortAsc ? "ascending" : "descending") : "none"}
          >
            <button
              type="button"
              className={`spine-focus-ring ${styles.headLabel} ${styles.headButton} ${
                active ? styles.headButtonActive : ""
              }`}
              onClick={() => onSort(col.field as SortField)}
            >
              {t(col.label)}
              {active ? <CaretIcon asc={sortAsc} /> : null}
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** Chip tipe berikon untuk tingkat isi Section. */
function TypeChip({ kind, ext }: { kind: string; ext?: string | null }) {
  const t = useTranslations("list.kind");
  if (kind === "folder") {
    return (
      <span className={`spine-chip ${styles.typeChip}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="7" width="16" height="13" rx="3" />
          <path d="M7 4h10" />
        </svg>
        {t("subSection")}
      </span>
    );
  }
  if (kind === "video") {
    return (
      <span className={`spine-chip ${styles.typeChip}`}>
        <svg className={styles.playGlyph} viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
          <path d="M0 0l10 6-10 6z" />
        </svg>
        {t("video")}
      </span>
    );
  }
  if (kind === "document") {
    return (
      <span className={`spine-chip ${styles.typeChip}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 3h7l5 5v13H6z" />
          <path d="M13 3v5h5" />
        </svg>
        {ext ? t("documentExt", { ext }) : t("document")}
      </span>
    );
  }
  if (kind === "audio") {
    return (
      <span className={`spine-chip ${styles.typeChip}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18V6l10-2v12" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="16.5" cy="16" r="2.5" />
        </svg>
        {t("audio")}
      </span>
    );
  }
  return (
    <span className={`spine-chip ${styles.typeChip}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 16l5-5 4 4 3-3 6 6" />
      </svg>
      {t("image")}
    </span>
  );
}

/** Sel kosong: "—" dengan label tersembunyi-visual "Tidak ada". */
function EmptyCell() {
  const t = useTranslations("list");
  return (
    <span className={styles.dash}>
      <span aria-hidden="true">—</span>
      <span className="spine-visually-hidden">{t("none")}</span>
    </span>
  );
}

function initialsOf(name?: string | null): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Baris kedua sub-Section: nama-namanya, jumlahnya, atau ketiadaannya. */
function subSectionLine(t: ListT, children?: { id: string; name: string }[] | null): string {
  const list = children ?? [];
  if (list.length === 0) return t("noSubSections");
  if (list.length <= 2) {
    return t("subSectionNames", {
      names: list.map((c) => parseSectionName(c.name).title).join(" · "),
    });
  }
  return t("subSectionCount", { count: list.length });
}

export type ListViewProps = {
  level: ListLevel;
  sortBy: SortField;
  sortAsc: boolean;
  onSort: (field: SortField) => void;

  projects?: any[];
  folders?: any[];
  files?: any[];

  selectedFolderIds: Set<string>;
  selectedFileIds: Set<string>;
  onToggleFolder: (id: string, idx: number, e: React.MouseEvent) => void;
  onToggleFile: (id: string, idx: number, e: React.MouseEvent) => void;
  selectMode: boolean;
  anySelected: boolean;

  onOpenProject: (id: string, title: string) => void;
  onOpenFolder: (id: string, name: string) => void;
  onOpenFile: (file: any) => void;
  onShareFile?: (id: string, name: string) => void;
  onProjectMenu: (project: any, anchor: Anchor) => void;
  onFolderMenu: (folder: any, anchor: Anchor) => void;
  onFileMenu: (file: any, anchor: Anchor) => void;
  /**
   * Story 3.3 — id item yang menu aksinya sedang terbuka. Barisnya tetap
   * dalam keadaan hover/fokus dan "⋯"-nya melaporkan `aria-expanded`.
   */
  menuOpenId?: string | null;

  canUpload: boolean;
  onUploadFirst: (projectId: string, title: string) => void;

  /**
   * Story 2.16 — keadaan runtime daftar. "ready" = ada baris;
   * "loading" / "error" / "empty" / "no-results" menggantikan isi daftar
   * DAN kepala kolomnya (kepala kolom kosong tidak pernah ditampilkan).
   */
  state?: "ready" | "loading" | "error" | "empty" | "no-results";
  /** Kata yang dicari — dipakai kalimat "Tidak ada hasil untuk …". */
  searchTerm?: string;
  onRetry?: () => void;
  /** CTA "Upload footage pertama" untuk Section kosong (role berhak). */
  onUploadHere?: () => void;

  /** Story 2.17 — sorotan seret di baris Section. Baris file dan baris
      Project BUKAN target drop. */
  draggableRows?: boolean;
  dragOverFolderId?: string | null;
  dragOverLabel?: string | null;
  onFolderDragOver?: (e: React.DragEvent, id: string) => void;
  onFolderDragLeave?: (e: React.DragEvent, id: string) => void;
  onFolderDrop?: (e: React.DragEvent, id: string) => void;
  onFolderDragStart?: (e: React.DragEvent, id: string) => void;
  onFileDragStart?: (e: React.DragEvent, id: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;

  determineType: (mimeType: string) => string;
};

/**
 * Mode daftar (Story 2.15/2.16) — `list-row` di tiga tingkat.
 *
 * Kepala kolom adalah `columnheader` yang SEKALIGUS tombol urut dan
 * mengubah keadaan urut BERSAMA `{ sortBy, sortAsc }` milik Story 2.5,
 * jadi berpindah grid ↔ daftar tidak pernah mengubah urutan. Tepat satu
 * kepala kolom memakai `aria-sort`; kolom aksi dan kolom centang tidak
 * berupa tombol dan tidak memakai `aria-sort` sama sekali.
 *
 * Setiap baris berisi TEPAT SATU kontrol pembuka yang direntangkan seluas
 * baris; centang, "⋯", dan CTA adalah sibling DI ATASNYA.
 */

/** Row accessible name from its non-empty parts: "Title, 5 files, 28 Sep 2026". */
function rowName(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => !!part && part.trim() !== "").join(", ");
}

export default function ListView(props: ListViewProps) {
  const {
    level,
    sortBy,
    sortAsc,
    onSort,
    projects = [],
    folders = [],
    files = [],
    selectedFolderIds,
    selectedFileIds,
    onToggleFolder,
    onToggleFile,
    selectMode,
    anySelected,
    onOpenProject,
    onOpenFolder,
    onOpenFile,
    onShareFile,
    onProjectMenu,
    onFolderMenu,
    onFileMenu,
    menuOpenId = null,
    canUpload,
    onUploadFirst,
    draggableRows = true,
    dragOverFolderId,
    dragOverLabel,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
    onFolderDragStart,
    onFileDragStart,
    onDragEnd,
    determineType,
    state = "ready",
    searchTerm,
    onRetry,
    onUploadHere,
  } = props;

  const t = useTranslations("list");
  const tCards = useTranslations("cards");
  const tCommon = useTranslations("common");
  const tCount = useTranslations("count");
  const fmt = useFormat();

  const label = t(`tableLabel.${level}`);

  /* ---------- Story 2.16: keadaan runtime ----------
     Keempatnya MENGGANTIKAN daftar beserta kepala kolomnya — daftar
     kosong tidak pernah menampilkan kepala kolom tanpa isi. */
  if (state === "loading") {
    return (
      <div className={styles.list}>
        <p className={`spine-body ${styles.loadingNote}`}>{tCommon("loading")}</p>
        {/* region ber-aria-busy="true" ada di dalam SkeletonRow */}
        <SkeletonRow rows={4} />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={styles.list}>
        {/* role="alert" ada di dalam ErrorBox; teks server mentah tidak
            pernah dioper ke sini. */}
        <ErrorBox text={t("errorText")} onRetry={onRetry} />
      </div>
    );
  }

  if (state === "no-results") {
    return (
      <div className={styles.list} role="status">
        <EmptyState
          variant="tile"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          }
          title={t("noResultsTitle")}
          text={t("noResultsText", { term: searchTerm ?? "" })}
        />
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className={styles.list}>
        <EmptyState
          variant="ghost"
          title={t("emptyTitle")}
          text={t("emptyText")}
          action={
            canUpload && onUploadHere ? (
              <PillButton variant="accent" onClick={onUploadHere}>
                {tCards("uploadFirst")}
              </PillButton>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.list} role="table" aria-label={label}>
      <ListHead level={level} sortBy={sortBy} sortAsc={sortAsc} onSort={onSort} />

      {level === "projects" &&
        projects.map((p: any) => {
          const total = Number(p.totalFiles) || 0;
          const isEmpty = total === 0;
          const dateText = p.createdAt ? fmt.date(new Date(p.createdAt)) : "";
          const accessibleName = rowName(p.title, tCount("files", { count: total }), dateText);
          return (
            <div
              key={p.id}
              className={`${styles.row} ${styles.projects}`}
              role="row"
              data-list-row
              data-menu-open={menuOpenId === p.id || undefined}
            >
              <div className={styles.nameCell} role="cell">
                <RepThumb variant="project" repFiles={p.repFiles as RepFile[]} empty={isEmpty} />
                <div className={styles.nameText}>
                  <span className={styles.titleLine}>
                    <span className={`spine-display-label ${styles.projectLabel}`} title={p.title}>
                      <span>{p.title}</span>
                    </span>
                  </span>
                  <span className={`${styles.meta} ${isEmpty ? styles.metaGhost : ""}`}>
                    {isEmpty
                      ? tCards("emptyDropHint")
                      : fmt.contentSentence(p.contentSummary)}
                  </span>
                </div>
              </div>

              <div
                role="cell"
                className={`${styles.colMeta} ${isEmpty && canUpload ? styles.ctaCell : ""}`}
              >
                {isEmpty && canUpload ? (
                  <PillButton
                    variant="accent"
                    className={styles.rowCta}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUploadFirst(p.id, p.title);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
                    </svg>
                    {tCards("uploadFirst")}
                  </PillButton>
                ) : isEmpty ? (
                  <EmptyCell />
                ) : (
                  <span className={styles.num}>
                    {fmt.number(total)}
                    <small>{tCount("fileWord", { count: total })}</small>
                  </span>
                )}
              </div>

              <div role="cell" className={`${styles.date} ${styles.colMeta}`}>
                {dateText || <EmptyCell />}
              </div>

              <div role="cell" className={styles.actions}>
                <MoreButton
                  itemName={p.title}
                  variant="in-caption"
                  expanded={menuOpenId === p.id}
                  className={styles.moreButton}
                  onOpen={(anchor) => onProjectMenu(p, anchor)}
                />
              </div>

              <a
                className={styles.rowLink}
                href={`/dashboard?p=${encodeURIComponent(p.id)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  onOpenProject(p.id, p.title);
                }}
              >
                <span className="spine-visually-hidden">{accessibleName}</span>
              </a>
            </div>
          );
        })}

      {level !== "projects" &&
        folders.map((f: any, idx: number) => {
          const { number, title } = parseSectionName(f.name);
          const total = Number(f.totalFiles) || 0;
          const isEmpty = total === 0;
          const selected = selectedFolderIds.has(f.id);
          const dateText = f.createdAt ? fmt.date(new Date(f.createdAt)) : "";
          const accessibleName = rowName(title, tCount("files", { count: total }), dateText);
          const isDropTarget = dragOverFolderId === f.id;
          return (
            <div
              key={f.id}
              className={`${styles.row} ${styles[level]} ${selected ? styles.selected : ""} ${
                isDropTarget ? styles.dropTarget : ""
              }`}
              role="row"
              data-list-row
              data-folder-id={f.id}
              data-menu-open={menuOpenId === f.id || undefined}
              data-select-mode={selectMode ? "" : undefined}
              data-any-selected={anySelected ? "" : undefined}
              draggable={draggableRows}
              onDragStart={(e) => onFolderDragStart?.(e, f.id)}
              onDragEnd={onDragEnd}
              onDragOver={(e) => onFolderDragOver?.(e, f.id)}
              onDragLeave={(e) => onFolderDragLeave?.(e, f.id)}
              onDrop={(e) => onFolderDrop?.(e, f.id)}
            >
              <div role="cell" className={styles.checkCell}>
                <SelectCheck
                  itemName={title}
                  checked={selected}
                  variant="surface"
                  className={styles.selectCheck}
                  onToggle={(e) => onToggleFolder(f.id, idx, e as unknown as React.MouseEvent)}
                />
              </div>

              <div className={styles.nameCell} role="cell">
                <RepThumb variant="section" repFiles={f.repFiles as RepFile[]} empty={isEmpty} />
                <div className={styles.nameText}>
                  <span className={styles.titleLine}>
                    {number ? (
                      <span className={`spine-display-label ${styles.numberSticker}`}>
                        <span className={styles.numberPrefix} aria-hidden="true">
                          {tCommon("numberPrefix")}
                        </span>
                        <span className="spine-visually-hidden">{tCommon("number")}</span> {number}
                      </span>
                    ) : null}
                    <b className={`spine-display-card ${styles.rowTitle}`} title={title}>
                      {title}
                    </b>
                  </span>
                  <span className={styles.meta}>
                    {level === "sections"
                      ? subSectionLine(t, f.children)
                      : t("subSectionFiles", { files: tCount("files", { count: total }) })}
                  </span>
                </div>
              </div>

              {level === "sections" ? (
                <>
                  <div role="cell" className={styles.colMeta}>
                    <span className={styles.num}>
                      {fmt.number(total)}
                      <small>{tCount("fileWord", { count: total })}</small>
                    </span>
                  </div>
                  <div role="cell" className={`${styles.date} ${styles.colMeta}`}>
                    {dateText || <EmptyCell />}
                  </div>
                </>
              ) : (
                <>
                  <div role="cell" className={styles.colMeta}>
                    <TypeChip kind="folder" />
                  </div>
                  <div role="cell" className={`${styles.date} ${styles.colMeta}`}>
                    {tCount("files", { count: total })}
                  </div>
                  <div role="cell" className={`${styles.date} ${styles.colMeta}`}>
                    {dateText || <EmptyCell />}
                  </div>
                  {/* "Diunggah oleh" tidak ada untuk sub-Section: skema hanya
                      menyimpan pengunggah pada MediaFile. */}
                  <div role="cell" className={`${styles.date} ${styles.colMeta}`}>
                    <EmptyCell />
                  </div>
                </>
              )}

              <div role="cell" className={styles.actions}>
                <MoreButton
                  itemName={title}
                  variant="in-caption"
                  expanded={menuOpenId === f.id}
                  className={styles.moreButton}
                  onOpen={(anchor) => onFolderMenu(f, anchor)}
                />
              </div>

              <a
                className={styles.rowLink}
                href={`/dashboard?f=${encodeURIComponent(f.id)}`}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                  e.preventDefault();
                  if (selectMode) {
                    onToggleFolder(f.id, idx, e as unknown as React.MouseEvent);
                    return;
                  }
                  onOpenFolder(f.id, f.name);
                }}
              >
                <span className="spine-visually-hidden">{accessibleName}</span>
              </a>

              {isDropTarget && dragOverLabel ? (
                <span className={`spine-nav ${styles.dragChip}`} role="status">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
                  </svg>
                  {dragOverLabel}
                </span>
              ) : null}
            </div>
          );
        })}

      {level === "files" &&
        files.map((file: any, idx: number) => {
          const kind = determineType(file.mimeType || "");
          const selected = selectedFileIds.has(file.id);
          const sizeText = fmt.fileSize(Number(file.size) || 0);
          const dateText = file.createdAt ? fmt.date(new Date(file.createdAt)) : "";
          const ext = (file.originalName?.split(".").pop() || "").toUpperCase();
          const kindLabel =
            kind === "video"
              ? t("kind.video")
              : kind === "image"
                ? t("kind.image")
                : kind === "audio"
                  ? t("kind.audio")
                  : t("kind.document");
          const accessibleName = t("fileRowName", {
            name: String(file.originalName ?? ""),
            kind: kindLabel,
            size: sizeText,
          });
          const thumb = (file.thumbnailUrl as string | null | undefined) ?? null;
          const uploader = file.uploadedBy?.name as string | undefined;
          return (
            <div
              key={file.id}
              className={`${styles.row} ${styles.files} ${selected ? styles.selected : ""}`}
              role="row"
              data-list-row
              data-file-id={file.id}
              data-menu-open={menuOpenId === file.id || undefined}
              data-select-mode={selectMode ? "" : undefined}
              data-any-selected={anySelected ? "" : undefined}
              draggable={draggableRows}
              onDragStart={(e) => onFileDragStart?.(e, file.id)}
              onDragEnd={onDragEnd}
            >
              <div role="cell" className={styles.checkCell}>
                <SelectCheck
                  itemName={file.originalName}
                  checked={selected}
                  variant="surface"
                  className={styles.selectCheck}
                  onToggle={(e) => onToggleFile(file.id, idx, e as unknown as React.MouseEvent)}
                />
              </div>

              <div className={styles.nameCell} role="cell">
                <RepThumb
                  variant="file"
                  file={{ kind, thumbnailUrl: thumb, extension: ext }}
                />
                <div className={styles.nameText}>
                  <span className={styles.titleLine}>
                    <b className={`${styles.rowTitle} ${styles.fileTitle}`} title={file.originalName}>
                      {file.originalName}
                    </b>
                  </span>
                  {/* Story 2.16: di HP kolom Tipe & Ukuran menyatu menjadi
                      satu baris meta; Tanggal dan "Diunggah oleh" PINDAH ke
                      viewer / panel info, tidak dihapus. */}
                  <span className={`${styles.meta} ${styles.metaMobile}`}>
                    {t("fileMeta", { kind: kindLabel, size: sizeText })}
                  </span>
                </div>
              </div>

              <div role="cell" className={styles.colMeta}>
                <TypeChip kind={kind} ext={kind === "document" ? ext : null} />
              </div>
              <div role="cell" className={`${styles.date} ${styles.colMeta}`}>
                {sizeText}
              </div>
              <div role="cell" className={`${styles.date} ${styles.colMeta}`}>
                {dateText || <EmptyCell />}
              </div>
              <div role="cell" className={styles.colMeta}>
                {uploader ? (
                  <span className={styles.uploader}>
                    <i aria-hidden="true">{initialsOf(uploader)}</i>
                    <span>{uploader}</span>
                  </span>
                ) : (
                  <EmptyCell />
                )}
              </div>

              <div role="cell" className={styles.actions}>
                {onShareFile ? (
                  <button
                    type="button"
                    className={`spine-focus-ring ${styles.shareButton}`}
                    aria-label={tCards("share", { name: String(file.originalName ?? "") })}
                    onClick={(e) => {
                      e.stopPropagation();
                      onShareFile(file.id, file.originalName);
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="18" cy="5" r="3" />
                      <circle cx="6" cy="12" r="3" />
                      <circle cx="18" cy="19" r="3" />
                      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
                    </svg>
                  </button>
                ) : null}
                <MoreButton
                  itemName={file.originalName}
                  variant="in-caption"
                  expanded={menuOpenId === file.id}
                  className={styles.moreButton}
                  onOpen={(anchor) => onFileMenu(file, anchor)}
                />
              </div>

              <button
                type="button"
                className={styles.rowLink}
                aria-label={accessibleName}
                onClick={(e) => {
                  if (selectMode) {
                    onToggleFile(file.id, idx, e as unknown as React.MouseEvent);
                    return;
                  }
                  // Perilaku hari ini dipertahankan: foto/video memakai viewer
                  // yang ada; dokumen tetap diunduh/dibuka seperti sekarang.
                  onOpenFile(file);
                }}
              />
            </div>
          );
        })}
    </div>
  );
}

export { SORT_LABEL };
