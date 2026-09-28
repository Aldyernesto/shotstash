"use client";

import React from "react";
import { useTranslations } from "next-intl";
import styles from "./BulkBar.module.css";

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function ZipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      <path d="M8.5 12.5l2.4 2.4 4.6-4.8" />
    </svg>
  );
}

export type BulkBarProps = {
  /** Jumlah item yang MASIH terpilih. */
  count: number;
  /**
   * "file" / "Section" / "item" (case-insensitive): picks the count
   * sentence from messages; any other value counts as "item".
   */
  noun: string;
  /** Kalimat hasil campuran/gagal yang MENGGANTIKAN kalimat jumlah. */
  resultText?: string | null;
  allSelected: boolean;
  /** Story 2.18: tombol Trash hanya dirender untuk role berhak. */
  canTrash: boolean;
  onToggleSelectAll: () => void;
  onCancel: () => void;
  onTrash: () => void;
  onDownloadZip: () => void;
};

/**
 * `bulk-bar` (Story 2.13) — desktop = pill mengambang di bawah-tengah area
 * konten; < 900 px = kartu yang MENGGANTIKAN `bottom-bar` di posisi yang
 * sama. Isinya identik di mode grid dan mode daftar.
 *
 * Konfirmasi dan umpan baliknya tetap memakai mekanisme yang ada sekarang
 * (`ConfirmModal` / `alert()` / `pushToast`); tidak ada `dialog`,
 * `confirm-sheet`, atau `toast` bergaya baru yang dirender di sini —
 * itu FR21 / Epic 4.
 */
export default function BulkBar({
  count,
  noun,
  resultText,
  allSelected,
  canTrash,
  onToggleSelectAll,
  onCancel,
  onTrash,
  onDownloadZip,
}: BulkBarProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const t = useTranslations("bulk");
  const tCommon = useTranslations("common");
  const nounKey = noun.toLowerCase();
  const countText =
    nounKey === "file"
      ? t("selectedFiles", { count })
      : nounKey === "section"
        ? t("selectedSections", { count })
        : t("selectedItems", { count });
  const headline = resultText || countText;

  // `scroll-padding-bottom` <main> mengikuti tinggi bar yang sedang tampil,
  // supaya elemen yang difokus keyboard tidak tertutup bar.
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const apply = () => {
      document.documentElement.style.setProperty(
        "--mam-bulkbar-height",
        `${Math.ceil(node.getBoundingClientRect().height)}px`,
      );
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(node);
    // Selama `bulk-bar` tampil, `bottom-bar` HP TIDAK dirender — bar ini
    // menggantikannya di posisi yang sama (AC 2.13).
    document.documentElement.dataset.mamBulkbar = "1";
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--mam-bulkbar-height");
      delete document.documentElement.dataset.mamBulkbar;
    };
  }, []);

  // Esc DI DALAM bar membatalkan mode pilih. Bar tidak pernah mencuri
  // fokus saat muncul — tidak ada autofocus di sini.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t("regionLabel")}
      className={styles.bar}
      onKeyDown={onKeyDown}
    >
      <div className={styles.row1}>
        <span className={`spine-body ${styles.count}`}>{headline}</span>
        <label className={`spine-body-sm ${styles.selectAll}`}>
          <input
            type="checkbox"
            className={`spine-focus-ring ${styles.selectAllBox}`}
            checked={allSelected}
            onChange={onToggleSelectAll}
          />
          {t("selectAll")}
        </label>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`spine-button spine-focus-ring ${styles.pill} ${styles.pillSurface} ${styles.cancelButton}`}
          onClick={onCancel}
        >
          {tCommon("cancel")}
        </button>
        {canTrash ? (
          <button
            type="button"
            className={`spine-button spine-focus-ring ${styles.pill} ${styles.pillDanger}`}
            onClick={onTrash}
          >
            <TrashIcon />
            {t("trash")}
          </button>
        ) : null}
        <button
          type="button"
          className={`spine-button spine-focus-ring ${styles.pill} ${styles.pillAccent}`}
          onClick={onDownloadZip}
        >
          <ZipIcon />
          {t("downloadZip")}
        </button>
      </div>
    </div>
  );
}
