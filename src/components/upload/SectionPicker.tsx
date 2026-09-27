"use client";

/**
 * Story 3.12 — "Pilih Section Tujuan".
 *
 * Muncul saat tujuan upload BELUM ditentukan (tombol "Upload Files" di
 * tingkat Project, atau slot "Upload" di `bottom-bar` HP). Memilih satu
 * Section langsung membuka `upload-panel` dengan Section itu sebagai
 * tujuan. Istilah yang dipakai "Section", bukan "Folder".
 *
 * Dipakai ulang saat `initiateUpload` menolak dengan "Section tujuan
 * sudah tidak ada" — antrean tetap terjaga.
 */

import React from "react";
import { Dialog } from "@/components/overlay/Dialog";
import { PillButton } from "@/components/form/buttons";
import { formatNumber } from "@/lib/format";
import { parseSectionName } from "@/lib/sectionNumber";
import styles from "./upload.module.css";

export type PickerSection = {
  id: string;
  name: string;
  totalFiles?: number | null;
};

const CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);

const PLUS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export default function SectionPicker({
  sections,
  onPick,
  onCreate,
  onClose,
}: {
  sections: PickerSection[];
  onPick: (section: PickerSection) => void;
  onCreate?: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      size="lg"
      mobilePlacement="bottom"
      mobilePreviewFirst={false}
      title="Pilih Section Tujuan"
      lead="Pilih Section untuk diupload, atau buat Section baru."
      closeLabel="Tutup"
      onClose={onClose}
      footer={
        <div className={styles.pickFooter}>
          {onCreate ? (
            <PillButton variant="paper" onClick={onCreate}>
              <span aria-hidden="true" style={{ display: "grid", placeItems: "center", width: 16, height: 16 }}>
                {PLUS}
              </span>
              Buat Section Baru
            </PillButton>
          ) : (
            <span />
          )}
          <PillButton variant="surface" onClick={onClose}>
            Cancel
          </PillButton>
        </div>
      }
    >
      {sections.length === 0 ? (
        /* Daftar kosong TIDAK PERNAH dikirim tanpa kalimat. */
        <p className={`spine-body-sm ${styles.pickEmpty}`}>
          Belum ada Section di project ini. Buat Section baru untuk mulai mengunggah.
        </p>
      ) : null}
      <ul className={styles.pickList}>
        {sections.map((s) => {
          const parsed = parseSectionName(s.name);
          const count = Number(s.totalFiles ?? 0) || 0;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`spine-focus-ring--inset ${styles.pickRow}`}
                onClick={() => onPick(s)}
              >
                {parsed.number ? (
                  <span className={`spine-display-label ${styles.sticker} ${styles.pickSticker}`}>
                    <small className="spine-sticker-unit" aria-hidden="true">
                      NO
                    </small>
                    <span className="spine-visually-hidden">Nomor </span>
                    {parsed.number}
                  </span>
                ) : (
                  <span className={styles.pickSticker} aria-hidden="true" />
                )}
                <b className={`spine-display-card ${styles.pickName}`}>{parsed.title}</b>
                <span className={`spine-chip ${styles.pickCount}`}>{formatNumber(count)} file</span>
                {CHEVRON}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
