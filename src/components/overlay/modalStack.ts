"use client";

/**
 * Story 3.1 — aturan "HANYA SATU LAPISAN MODAL", ditegakkan di satu tempat.
 *
 * Kontrak:
 *  1. Setiap lapisan (dialog, confirm-sheet, more-sheet, viewer) mendaftar
 *     di tumpukan ini saat dipasang dan keluar saat dilepas.
 *  2. Esc hanya sampai ke lapisan PALING ATAS, satu tingkat per tekan —
 *     tidak pernah melompati tingkat. Urutan di dalam satu lapisan
 *     (keluar layar penuh → tutup lembar info → tutup viewer) adalah milik
 *     `onEsc` lapisan itu, bukan tumpukan ini.
 *  3. Lapisan ber-`role="dialog"`/`alertdialog` (`modal: true`) tidak boleh
 *     dua sekaligus. Kalau terjadi, ini berteriak di konsol pengembangan —
 *     pertanyaan lanjutan harus MENGGANTI isi lapisan yang sudah terbuka
 *     (preseden `heic-question`), bukan membuka dialog kedua.
 *  4. Selama ada lapisan modal, `<body>` tidak bergulir.
 */

import { useEffect, useRef } from "react";

export type Layer = {
  id: number;
  onEsc: () => void;
  /** true untuk role="dialog"/"alertdialog"; false untuk popover menu. */
  modal: boolean;
};

const stack: Layer[] = [];
let nextId = 1;
let bound = false;
let bodyOverflow: string | null = null;

function handleKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  top.onEsc();
}

function syncBodyScroll() {
  if (typeof document === "undefined") return;
  const hasModal = stack.some((l) => l.modal);
  if (hasModal && bodyOverflow === null) {
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else if (!hasModal && bodyOverflow !== null) {
    document.body.style.overflow = bodyOverflow;
    bodyOverflow = null;
  }
}

function push(layer: Layer) {
  if (layer.modal && stack.some((l) => l.modal) && process.env.NODE_ENV !== "production") {
    // Bukan crash — tetapi tidak boleh lolos tanpa terlihat.
    console.error(
      "[spine] Dua lapisan modal terbuka sekaligus. Aturan satu lapisan modal (Story 3.1): " +
        "pertanyaan lanjutan MENGGANTI isi lapisan yang sudah terbuka, tidak membuka dialog kedua.",
    );
  }
  stack.push(layer);
  if (!bound) {
    document.addEventListener("keydown", handleKeyDown, true);
    bound = true;
  }
  syncBodyScroll();
}

function pop(id: number) {
  const index = stack.findIndex((l) => l.id === id);
  if (index >= 0) stack.splice(index, 1);
  if (!stack.length && bound) {
    document.removeEventListener("keydown", handleKeyDown, true);
    bound = false;
  }
  syncBodyScroll();
}

/**
 * Mendaftarkan sebuah lapisan selama komponennya terpasang.
 * `onEsc` selalu dibaca dari ref, jadi handler terbaru yang dipakai tanpa
 * mendaftar ulang lapisannya.
 */
export function useModalLayer(onEsc: () => void, options?: { modal?: boolean; enabled?: boolean }) {
  const modal = options?.modal ?? true;
  const enabled = options?.enabled ?? true;
  const escRef = useRef(onEsc);
  escRef.current = onEsc;

  useEffect(() => {
    if (!enabled) return;
    const layer: Layer = { id: nextId++, onEsc: () => escRef.current(), modal };
    push(layer);
    return () => pop(layer.id);
  }, [enabled, modal]);
}

/** Elemen yang bisa menerima fokus di dalam sebuah lapisan. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableWithin(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Kunci fokus di dalam lapisan + kembalikan fokus ke pemicu saat tutup.
 * Fokus awal: elemen dari `initialFocus` bila ada, kalau tidak elemen
 * fokusable pertama di dalam lapisan.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  options?: { active?: boolean; initialFocus?: React.RefObject<HTMLElement | null> },
) {
  const active = options?.active ?? true;
  const initialRef = options?.initialFocus;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previous = document.activeElement as HTMLElement | null;

    const target = initialRef?.current ?? focusableWithin(container)[0] ?? container;
    // `preventScroll` supaya lapisan tidak menggulir halaman di belakangnya.
    target.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusableWithin(container);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (current === first || !container.contains(current)) {
          event.preventDefault();
          last.focus();
        }
      } else if (current === last || !container.contains(current)) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Fokus kembali PERSIS ke elemen pemicu.
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
