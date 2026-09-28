"use client";

/**
 * Story 3.2 — `toast`, umpan balik hasil aksi bersama.
 *
 * ============================================================
 * DUA DAFTAR YANG DIPERIKSA SAAT REVIEW GELOMBANG (AC 3.2)
 * ============================================================
 * Ini bukan catatan; ini gerbangnya. Layar di daftar A tidak boleh lagi
 * memanggil `alert()`, dan layar di daftar B tidak boleh merender toast
 * bergaya baru setengah jalan.
 *
 * A. BERPINDAH KE `toast` DI GELOMBANG INI (Epic 3)
 *    1. `share-modal` — salin tautan .................... Story 3.8
 *    2. Admin Panel — hasil setujui/tolak (di samping
 *       `notice-bar`) ................................... Story 3.18
 *    3. Halaman Shared — salin tautan, cabut akses, dan
 *       kegagalannya (`dashboard/shared/page.tsx:37,43,50`) Story 3.22
 *    4. Halaman Trash — Restore, Delete Forever, dan
 *       kegagalannya .................................... Story 3.21
 *    5. Viewer / unduhan Agen .......................... Story 3.7
 *    6. Panel Diskusi project: gagal mengirim pesan .... Story 3.17
 *    7. `context-menu`: hasil aksi merusak ............. Story 3.3
 *
 * B. TETAP MEMAKAI `pushToast` / `alert()` / `confirm()` HARI INI,
 *    SAMPAI EPIC 4 — jangan disentuh di gelombang ini:
 *    - seluruh jalur di `src/app/dashboard/page.tsx`: Trash file &
 *      Section, gagal memindahkan, ZIP banyak Section, Move/Copy gagal
 *    - aksi `bulk-bar` dan aksi kartu dari Epic 2
 *    - umpan balik drop `drag-over`
 *
 * ============================================================
 * KONTRAK
 * ============================================================
 * - Sukses: `role="status"`, hilang sendiri setelah ±4 detik
 *   ([ASSUMPTION] EXPERIENCE.md → Component Patterns → `toast`).
 * - Error: `role="alert"`, BERTAHAN sampai ditutup atau sampai aksi
 *   berikutnya ([ASSUMPTION] sumber yang sama). "Aksi berikutnya" =
 *   toast berikutnya yang didorong ke antrean.
 * - Pengumuman tidak pernah memindahkan fokus.
 * - Copy comes from messages; raw server text is never passed through
 *   as is (see `errorKind` / `useHumanizeError`).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import styles from "./toast.module.css";

export type ToastTone = "success" | "error";

export type ToastInput = {
  tone?: ToastTone;
  message: string;
  /** Short translated cause, appended after the message. */
  cause?: string | null;
};

type ToastItem = ToastInput & { id: number; tone: ToastTone };

const SUCCESS_MS = 4000;

const ToastContext = createContext<{
  pushToast: (input: ToastInput | string) => void;
  dismissToast: (id: number) => void;
} | null>(null);

let nextId = 1;

const OK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

const ERR_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, number>());
  const mounted = useMounted();
  const tc = useTranslations("common");

  const dismissToast = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((list) => list.filter((x) => x.id !== id));
  }, []);

  const pushToast = useCallback(
    (input: ToastInput | string) => {
      const next: ToastItem =
        typeof input === "string"
          ? { id: nextId++, tone: "success", message: input }
          : { id: nextId++, tone: input.tone ?? "success", message: input.message, cause: input.cause };

      setItems((list) => {
        // "Sampai aksi berikutnya": toast error lama dibersihkan saat toast
        // baru datang, jadi tidak pernah ada tumpukan error basi.
        for (const old of list) {
          const t = timers.current.get(old.id);
          if (t) window.clearTimeout(t);
          timers.current.delete(old.id);
        }
        return [next];
      });

      if (next.tone === "success") {
        const t = window.setTimeout(() => dismissToast(next.id), SUCCESS_MS);
        timers.current.set(next.id, t);
      }
    },
    [dismissToast],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => window.clearTimeout(t));
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div className={styles.host}>
              {items.map((item) => (
                <div
                  key={item.id}
                  role={item.tone === "error" ? "alert" : "status"}
                  className={`${styles.toast} ${item.tone === "error" ? styles.toastError : ""}`}
                >
                  <span className={styles.icon} aria-hidden="true">
                    {item.tone === "error" ? ERR_ICON : OK_ICON}
                  </span>
                  <span className={`spine-body ${styles.text}`}>
                    {item.message}
                    {item.cause ? ` ${item.cause}` : ""}
                  </span>
                  {item.tone === "error" ? (
                    <button
                      type="button"
                      className={`spine-focus-ring spine-chip ${styles.close}`}
                      onClick={() => dismissToast(item.id)}
                    >
                      {tc("close")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

/**
 * Di luar `ToastProvider` hook ini tidak melempar — ia mengembalikan
 * no-op, supaya komponen bersama (viewer, context-menu) bisa dipakai di
 * layar yang belum memasang provider tanpa membuat layar itu crash.
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  return (
    ctx ?? {
      pushToast: () => undefined,
      dismissToast: () => undefined,
    }
  );
}

export type ErrorKind = "offline" | "session" | "notFound" | "timeout" | "server" | "generic";

/**
 * Classifies a network/server failure so it can be shown as ONE plain
 * sentence. "Failed to fetch", "HTTP 502", "Unauthorized" are never shown
 * as they are (EXPERIENCE.md, network / server errors). Pure.
 */
export function errorKind(err: unknown): ErrorKind {
  const raw = String(
    (err as { message?: string } | null | undefined)?.message ?? err ?? "",
  ).toLowerCase();
  if (!raw) return "generic";
  if (raw.includes("unauthorized") || raw.includes("401") || raw.includes("403")) return "session";
  if (raw.includes("failed to fetch") || raw.includes("networkerror") || raw.includes("network error")) {
    return "offline";
  }
  if (raw.includes("404") || raw.includes("not found")) return "notFound";
  if (raw.includes("timeout") || raw.includes("aborted")) return "timeout";
  if (/\b5\d\d\b/.test(raw)) return "server";
  return "generic";
}

/* Previous Indonesian sentences, kept exactly for the screens not yet
   translated (Story 3.4 moves them to useHumanizeError and removes this). */
const LEGACY_SENTENCE: Record<ErrorKind, string> = {
  offline: "Sambungan ke server terputus.", // i18n-ignore
  session: "Sesi kamu sudah tidak berlaku.", // i18n-ignore
  notFound: "Datanya tidak ditemukan lagi.", // i18n-ignore
  timeout: "Server terlalu lama menjawab.", // i18n-ignore
  server: "Server sedang bermasalah.", // i18n-ignore
  generic: "Sambungan bermasalah.", // i18n-ignore
};

/**
 * @deprecated Untranslated screens only (Story 3.4): returns the previous
 * Indonesian sentence unchanged. Components use `useHumanizeError()`.
 */
export function humanizeError(err: unknown): string {
  return LEGACY_SENTENCE[errorKind(err)];
}

/** `(err) => sentence` in the active locale, from the `errors` messages. */
export function useHumanizeError(): (err: unknown) => string {
  const t = useTranslations("errors");
  return useCallback((err: unknown) => t(errorKind(err)), [t]);
}
