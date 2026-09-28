"use client";

/**
 * Story 3.13 — `heic-question`.
 *
 * MENGGANTI isi `upload-panel`; tidak ada dialog kedua di atas panel
 * (aturan satu lapisan modal, Story 3.1 — preseden yang ditulis di
 * `modalStack.ts` justru komponen ini).
 *
 * Fokus pindah ke judul pertanyaan saat isi berganti, dan Esc tidak
 * menutup panel selama pertanyaan belum dijawab (panel memakai `locked`).
 * Jawabannya berlaku untuk SEMUA file HEIC di upload itu dan pertanyaan
 * muncul sekali per sesi.
 */

import React, { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { PillButton } from "@/components/form/buttons";
import styles from "./upload.module.css";

const ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function HeicStickers() {
  return (
    <div className={styles.heic} aria-hidden="true">
      <span className={`spine-display-card ${styles.heicChip} ${styles.heicFrom}`}>HEIC</span>
      <span className={styles.heicArrow}>{ARROW}</span>
      <span className={`spine-display-card ${styles.heicChip} ${styles.heicTo}`}>JPG</span>
    </div>
  );
}

export function HeicBody({ titleId }: { titleId: string }) {
  const t = useTranslations("upload.heic");
  const ref = useRef<HTMLParagraphElement>(null);

  // Fokus pindah ke judul pertanyaan saat isi panel berganti.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <>
      <HeicStickers />
      <p id={titleId} ref={ref} tabIndex={-1} className="spine-body">
        {t.rich("body", { b: (chunks) => <b>{chunks}</b> })}
      </p>
      <p className={`spine-footnote ${styles.heicNote}`}>
        {t("note")}
      </p>
    </>
  );
}

export function HeicActions({
  onConvert,
  onKeep,
}: {
  onConvert: () => void;
  onKeep: () => void;
}) {
  const t = useTranslations("upload.heic");
  return (
    <div className={styles.heicActions}>
      <PillButton variant="accent" onClick={onConvert}>
        <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 16, height: 16 }}>
          {CHECK}
        </span>
        {t("convert")}
      </PillButton>
      <PillButton variant="surface" onClick={onKeep}>
        {t("keep")}
      </PillButton>
    </div>
  );
}
