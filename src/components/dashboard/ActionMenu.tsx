"use client";

/**
 * Story 3.3 — `context-menu`: SATU komponen untuk klik-kanan, Shift+F10,
 * dan tombol "⋯", di desktop (popover) maupun HP (sheet dari bawah).
 *
 * Menggantikan `src/components/ContextMenu.tsx` (ikon emoji, gaya inline).
 * Isi menunya dirakit pemanggil — gerbang role dan label ada di
 * `src/app/dashboard/page.tsx`, supaya komponen ini tidak pernah jadi
 * sumber kedua aturan hak akses.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import styles from "./ActionMenu.module.css";
import { useFocusTrap, useModalLayer } from "@/components/overlay/modalStack";

export type ActionMenuEntry =
  | {
      kind: "item";
      id: string;
      label: string;
      icon: React.ReactNode;
      /** Keterangan kanan: "Permanen" / "30 hari". */
      hint?: string;
      danger?: boolean;
      /** "Versi aman (blur)" item: accent shield icon. */
      safe?: boolean;
      /**
       * Item TAUTAN (menu "Lainnya" nav-capsule desktop): dirender sebagai
       * `<Link role="menuitem">`, bukan tombol — tujuan tetap tautan nyata
       * (buka di tab baru, salin alamat, Enter = pindah halaman).
       */
      href?: string;
      /** Tujuan yang sedang aktif: `aria-current="page"` + accent pill with white text. */
      current?: boolean;
      /** Hiasan setelah label (accent worker dot): pemanggil memberi aria-hidden. */
      trailing?: React.ReactNode;
      /** Wajib untuk item tombol; item tautan boleh tanpa (navigasi = aksinya). */
      onSelect?: () => void;
    }
  | { kind: "separator"; id: string }
  /** Story 3.7: `progress-pill` menggantikan item unduh DI TEMPAT. */
  | { kind: "custom"; id: string; render: React.ReactNode };

export type ActionMenuTarget = {
  /** Kata jenis di kepala menu: "PROJECT" / "SECTION" / "FILE". */
  kindLabel: string;
  name: string;
  /** Baris meta kepala sheet HP ("Section · 214 file"). */
  meta?: string;
  /** `rep-thumb` untuk kepala sheet HP. */
  thumb?: React.ReactNode;
};

export type ActionMenuProps = {
  anchor: { x: number; y: number };
  target: ActionMenuTarget;
  entries: ActionMenuEntry[];
  onClose: () => void;
};

/** `(min-width: 900px)` sebagai satu sumber wujud desktop vs HP. */
function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia("(min-width: 900px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

const CLOSE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export default function ActionMenu({ anchor, target, entries, onClose }: ActionMenuProps) {
  const desktop = useIsDesktop();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const headId = useId();

  useEffect(() => setMounted(true), []);

  // Esc menutup SATU tingkat: menu dulu, kipas/ayunan kartu baru di Esc
  // kedua (ditangani kartunya sendiri karena fokus kembali ke kartu).
  // Popover bukan lapisan modal; sheet HP adalah (role="dialog").
  useModalLayer(onClose, { modal: !desktop });
  useFocusTrap(rootRef, { active: mounted && !desktop });

  /* Esc / pilih item / klik di luar → fokus kembali ke kartu atau ke "⋯".
     Sheet HP diurus `useFocusTrap`; popover desktop diurus di sini. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  if (returnFocusRef.current === null && typeof document !== "undefined") {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
  }
  useEffect(() => {
    if (!desktop) return;
    return () => {
      const el = returnFocusRef.current;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, [desktop]);

  const items = entries.filter((e) => e.kind === "item") as Extract<ActionMenuEntry, { kind: "item" }>[];

  /* --------------------------------------------------------------
     Posisi popover: muncul di kursor, DIGESER MASUK bila mepet tepi
     layar — diukur SETELAH terpasang, jadi tingginya yang sebenarnya
     yang dipakai (bukan taksiran items.length × 36 seperti dulu).
     -------------------------------------------------------------- */
  useEffect(() => {
    if (!mounted || !desktop) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 12;
    const left = Math.max(pad, Math.min(anchor.x, window.innerWidth - rect.width - pad));
    const top = Math.max(pad, Math.min(anchor.y, window.innerHeight - rect.height - pad));
    setPos({ left, top });
  }, [mounted, desktop, anchor.x, anchor.y, entries.length]);

  /* Fokus awal di item pertama supaya panah langsung bekerja.
     PENTING: baru setelah popover terlihat — selama `visibility: hidden`
     (sebelum posisinya diukur) elemen di dalamnya tidak bisa difokus. */
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!mounted || focusedOnce.current) return;
    if (desktop && !pos) return;
    const first = listRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    if (!first) return;
    focusedOnce.current = true;
    first.focus({ preventScroll: true });
  }, [mounted, desktop, pos]);

  /* Tutup saat mousedown di luar / halaman bergulir (perilaku sekarang). */
  useEffect(() => {
    if (!desktop) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [desktop, onClose]);

  const moveFocus = useCallback((delta: number | "first" | "last") => {
    const nodes = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (!nodes.length) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (delta === "first") next = 0;
    else if (delta === "last") next = nodes.length - 1;
    else next = (current + delta + nodes.length) % nodes.length;
    nodes[next]?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveFocus("first");
    } else if (e.key === "End") {
      e.preventDefault();
      moveFocus("last");
    }
  };

  const renderEntries = (mobile: boolean) =>
    entries.map((entry) => {
      if (entry.kind === "separator") {
        return <div key={entry.id} className={styles.sep} role="separator" />;
      }
      if (entry.kind === "custom") {
        return <React.Fragment key={entry.id}>{entry.render}</React.Fragment>;
      }
      const body = (
        <>
          {entry.icon}
          <span className={styles.label}>{entry.label}</span>
          {entry.trailing ?? null}
          {entry.hint ? <span className={styles.hint}>{entry.hint}</span> : null}
        </>
      );
      const onPick = () => {
        entry.onSelect?.();
        onClose();
      };
      if (entry.href) {
        // Tautan nyata di dalam menu: Enter/klik = navigasi bawaan Link,
        // menu ditutup di klik yang sama (fokus kembali ke pemicu "Lainnya").
        return (
          <Link
            key={entry.id}
            href={entry.href}
            role="menuitem"
            tabIndex={-1}
            aria-current={entry.current ? "page" : undefined}
            className={`spine-focus-ring--inset ${styles.item} ${entry.current ? styles.current : ""}`}
            onClick={onPick}
          >
            {body}
          </Link>
        );
      }
      return (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          tabIndex={-1}
          // Cincin fokus DI DALAM item (offset -2px) supaya tidak terpotong
          // tepi menu, termasuk di tema terang.
          className={`spine-focus-ring--inset ${styles.item} ${entry.danger ? styles.danger : ""} ${
            entry.safe ? styles.safe : ""
          }`}
          onClick={onPick}
        >
          {body}
        </button>
      );
    });

  if (!mounted) return null;

  const headText = `${target.kindLabel} · ${target.name}`;

  if (desktop) {
    return createPortal(
      <div
        ref={rootRef}
        className={styles.menu}
        style={{
          left: pos ? pos.left : anchor.x,
          top: pos ? pos.top : anchor.y,
          // Sebelum diukur, jangan berkedip di posisi yang salah.
          visibility: pos ? "visible" : "hidden",
        }}
        onKeyDown={onKeyDown}
      >
        <p id={headId} className={`spine-label ${styles.head}`}>
          <span>{headText}</span>
        </p>
        <div ref={listRef} role="menu" aria-labelledby={headId}>
          {renderEntries(false)}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={rootRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Aksi untuk ${target.name}`}
        className={styles.sheet}
        onKeyDown={onKeyDown}
      >
        <span className={styles.handle} aria-hidden="true" />
        <div className={styles.sheetHead}>
          {target.thumb ? <span aria-hidden="true">{target.thumb}</span> : null}
          <div className={styles.sheetHeadText}>
            <p className={styles.sheetHeadName}>
              <span>{target.name}</span>
            </p>
            {target.meta ? (
              <small className={`spine-footnote ${styles.sheetHeadMeta}`}>{target.meta}</small>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Tutup"
            className={`spine-focus-ring ${styles.sheetClose}`}
            onClick={onClose}
          >
            {CLOSE_ICON}
          </button>
        </div>
        <div ref={listRef} role="menu" aria-label={`Aksi untuk ${target.name}`} className={styles.sheetList}>
          {renderEntries(true)}
        </div>
      </section>
    </div>,
    document.body,
  );
}
