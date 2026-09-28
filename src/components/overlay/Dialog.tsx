"use client";

/**
 * Story 3.1 — `dialog` (≥ 900 px) dan `confirm-sheet` (< 900 px).
 *
 * SATU komponen, SATU pohon markup. Perbedaan desktop ↔ HP seluruhnya
 * diurus CSS (`overlay.module.css`): lebar 440 px vs lebar penuh, sudut
 * atas sheet + gagang, pratinjau naik ke atas judul, tombol bertumpuk
 * 52 px dengan aksi lebih dulu. Tidak ada dua pohon markup yang bisa
 * berbeda diam-diam, dan tidak ada breakpoint di JavaScript (jadi juga
 * tidak ada ketidakcocokan hidrasi).
 *
 * Aturan satu lapisan modal ada di `modalStack.ts`; pertanyaan lanjutan
 * MENGGANTI `children`/`body` lapisan ini, tidak membuka dialog kedua.
 */

import React, { useId, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./overlay.module.css";
import { useFocusTrap, useModalLayer } from "./modalStack";
import { ButtonDanger, PillButton } from "@/components/form/buttons";

function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

export type DialogPreview = {
  /** `rep-thumb` (atau apa pun yang seukuran) — dekoratif. */
  thumb?: React.ReactNode;
  name: React.ReactNode;
  meta?: React.ReactNode;
};

export type DialogProps = {
  /** Judul huruf display; juga `aria-labelledby`. */
  title: React.ReactNode;
  /** Kalimat lead di bawah judul; juga `aria-describedby` bila ada. */
  lead?: React.ReactNode;
  preview?: DialogPreview;
  /** Isi tambahan (radio-card, info-note, one-time-secret, dst.). */
  children?: React.ReactNode;
  /** Tombol aksi; urutan DOM = [Batal, aksi] (lihat CSS `.actions`). */
  actions?: React.ReactNode;
  /**
   * Footer BEBAS (ringkasan kiri + tombol kanan) yang menggantikan
   * `actions` seluruhnya — dipakai `upload-panel` (Story 3.12) yang
   * footernya bukan sekadar deret tombol. Tetap satu pohon markup.
   */
  footer?: React.ReactNode;
  /** Tindakan merusak → `role="alertdialog"`. */
  destructive?: boolean;
  /**
   * `md` = 440px (konfirmasi, Story 3.1);
   * `lg` = 520px (`share-modal` Story 3.8, `upload-panel` Story 3.12).
   */
  size?: "md" | "lg";
  /**
   * `bottom` = confirm-sheet di HP (bawaan untuk konfirmasi);
   * `top` = dialog non-merusak menempel di atas layar HP.
   */
  mobilePlacement?: "bottom" | "top";
  /** Dialog yang memuat `one-time-secret` TIDAK boleh tertutup klik luar. */
  dismissOnBackdrop?: boolean;
  /**
   * Di sheet HP, baris pratinjau naik ke ATAS judul (urutan mock
   * `key-context-menu.html` 05d — bawaan Story 3.1). `share-modal`
   * mematikannya: mock `key-share-modal.html` 03 menaruh `.who` DI BAWAH
   * judul, sama dengan desktop.
   */
  mobilePreviewFirst?: boolean;
  /**
   * Menampilkan tombol tutup × di pojok kanan-atas panel. Nilainya adalah
   * nama aksesibelnya; tanpa prop ini tombolnya tidak dirender.
   */
  closeLabel?: string;
  /** Tombol tutup × diredupkan & tidak berfungsi (batch upload berjalan). */
  closeDisabled?: boolean;
  /**
   * Kontrol tambahan di kepala panel, di KIRI tombol tutup — dipakai
   * "Kecilkan" `upload-panel` (Story 3.15).
   */
  headerExtra?: React.ReactNode;
  /** Esc & klik luar dimatikan (batch upload berjalan, Story 3.12). */
  locked?: boolean;
  /**
   * Story 4.6 (aditif): blok SETELAH footer — bagian "Link aktif"
   * `share-modal`. Desktop: di bawah deret tombol (mock
   * `key-share-modal.html` 01: `.acts` lalu `.ex`); HP: di dalam isi yang
   * bergulir DI ATAS footer yang menempel (mock 03: `.scroll` lalu `.foot`).
   * Urutannya diatur `order` di CSS — tetap satu pohon markup.
   */
  after?: React.ReactNode;
  /**
   * Story 4.6 (aditif): di HP footer menempel di tepi bawah sheet sementara
   * isi + `after` bergulir di atasnya. Tanpa prop ini perilaku lama persis.
   */
  stickyFooter?: boolean;
  onClose: () => void;
  /** Fokus awal — untuk konfirmasi merusak selalu tombol "Batal". */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
};

export function Dialog({
  title,
  lead,
  preview,
  children,
  actions,
  footer,
  destructive = false,
  size = "md",
  mobilePlacement = destructive ? "bottom" : "top",
  dismissOnBackdrop = true,
  mobilePreviewFirst = true,
  closeLabel,
  closeDisabled = false,
  headerExtra,
  locked = false,
  after,
  stickyFooter = false,
  onClose,
  initialFocusRef,
}: DialogProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const leadId = useId();

  useModalLayer(() => {
    if (locked) return;
    onClose();
  }, { modal: true });
  // `active: mounted` PENTING: render pertama belum memasang portal, jadi
  // panelRef masih kosong. Tanpa dependensi ini jebakan fokus tidak pernah
  // dijalankan ulang dan fokus awal tidak pernah mendarat di "Batal".
  useFocusTrap(panelRef, { active: mounted, initialFocus: initialFocusRef });

  // Story 3.2: `toast` di HP duduk tepat di atas `bottom-bar` — dan di atas
  // TEPI SHEET bila sebuah sheet sedang terbuka. Tinggi sheet diukur di
  // sini dan dipinjamkan ke host toast lewat satu custom property.
  React.useEffect(() => {
    if (!mounted || mobilePlacement !== "bottom") return;
    const panel = panelRef.current;
    if (!panel) return;
    const sync = () => {
      document.documentElement.style.setProperty(
        "--mam-toast-lift",
        `${Math.round(panel.getBoundingClientRect().height)}px`,
      );
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(panel);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--mam-toast-lift");
    };
  }, [mounted, mobilePlacement]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={styles.backdrop}
      data-placement={mobilePlacement}
      onMouseDown={(e) => {
        if (!dismissOnBackdrop || locked) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={destructive ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={lead ? leadId : undefined}
        className={`${styles.panel} ${size === "lg" ? styles.panelLg : ""}`}
      >
        <span className={styles.handle} aria-hidden="true" />
        <h2 id={titleId} className={`spine-display-panel ${styles.title}`}>
          {title}
        </h2>
        {closeLabel || headerExtra ? (
          <div className={styles.headerActions}>
            {headerExtra}
            {closeLabel ? (
              <button
                type="button"
                aria-label={closeLabel}
                aria-disabled={closeDisabled || undefined}
                className={`spine-focus-ring ${styles.close} ${closeDisabled ? styles.closeOff : ""}`}
                onClick={() => {
                  if (closeDisabled) return;
                  onClose();
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
        {lead ? (
          <p id={leadId} className={`spine-body ${styles.lead}`}>
            {lead}
          </p>
        ) : null}
        {preview ? (
          <div className={`${styles.who} ${mobilePreviewFirst ? "" : styles.whoAfterTitle}`}>
            {preview.thumb ? <span aria-hidden="true">{preview.thumb}</span> : null}
            <div className={styles.whoText}>
              <p className={`spine-row-title ${styles.whoName}`}>{preview.name}</p>
              {preview.meta ? (
                <small className={`spine-footnote ${styles.whoMeta}`}>{preview.meta}</small>
              ) : null}
            </div>
          </div>
        ) : null}
        {children ? <div className={styles.body}>{children}</div> : null}
        {footer ? (
          <div className={`${styles.footer} ${stickyFooter ? styles.footerSticky : ""}`}>{footer}</div>
        ) : null}
        {!footer && actions ? <div className={styles.actions}>{actions}</div> : null}
        {after ? <div className={styles.after}>{after}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* ConfirmDialog — konfirmasi bergaya, menggantikan `confirm()`         */
/* ------------------------------------------------------------------ */

export type ConfirmDialogProps = {
  title: React.ReactNode;
  lead?: React.ReactNode;
  preview?: DialogPreview;
  /**
   * `recoverable` = "Move to Trash" (30 hari), "Restore" -> accent button.
   * `permanent`   = "Delete Forever" → `button-danger.solid`.
   * Aturan ini milik Story 1.14; di sini hanya ditetapkan KAPAN dipakai.
   */
  tone?: "recoverable" | "permanent";
  /**
   * Story 3.23 (aditif): `false` merender `role="dialog"`, bukan
   * `alertdialog` — dipakai konfirmasi yang BUKAN peringatan, mis.
   * "Restore Section ini?" pada mock `key-trash.html` 05. Bawaannya
   * tetap `true`, jadi perilaku seluruh pemanggil lama tidak berubah.
   */
  alert?: boolean;
  confirmLabel: React.ReactNode;
  cancelLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  icon?: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  lead,
  preview,
  tone = "recoverable",
  alert = true,
  confirmLabel,
  cancelLabel = "Batal",
  busyLabel = "Memproses...",
  busy = false,
  icon,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  // Fokus awal SELALU di aksi aman, tidak pernah di tombol merusak.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const sentRef = useRef(false);

  const fire = () => {
    // Kiriman kedua diabaikan.
    if (busy || sentRef.current) return;
    sentRef.current = true;
    onConfirm();
  };

  const confirmProps = {
    "aria-busy": busy || undefined,
    "aria-disabled": busy || undefined,
    onClick: fire,
  } as const;

  return (
    <Dialog
      destructive={alert}
      /* Konfirmasi SELALU `confirm-sheet` di HP, termasuk varian
         `alert={false}` yang bukan peringatan — tanpa baris ini
         bawaan Dialog akan memindahkannya ke atas layar. */
      mobilePlacement="bottom"
      title={title}
      lead={lead}
      preview={preview}
      onClose={busy ? () => undefined : onClose}
      initialFocusRef={cancelRef}
      actions={
        <>
          <PillButton ref={cancelRef} variant="surface" onClick={onClose}>
            {cancelLabel}
          </PillButton>
          {tone === "permanent" ? (
            <ButtonDanger variant="solid" {...confirmProps}>
              {busy ? busyLabel : (
                <>
                  {icon}
                  {confirmLabel}
                </>
              )}
            </ButtonDanger>
          ) : (
            <PillButton variant="accent" {...confirmProps}>
              {busy ? busyLabel : (
                <>
                  {icon}
                  {confirmLabel}
                </>
              )}
            </PillButton>
          )}
        </>
      }
    />
  );
}
