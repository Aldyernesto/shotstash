"use client";

/**
 * Story 3.11 — keadaan link tidak berlaku dan link PRIVATE.
 *
 * SATU susunan untuk semua keadaan: topbar (logo + `theme-toggle`) →
 * panggung berisi objek `project-empty` TANPA label → kartu info berisi
 * judul + satu kalimat. Panggung tetap gelap di dua tema dan tetap diam.
 *
 * Isi TIDAK PERNAH bocor: tidak ada nama Project/Section, jumlah file,
 * thumbnail, maupun nama file di keadaan mana pun — termasuk PRIVATE.
 * Objek panggung sengaja memakai slot label KOSONG.
 *
 * Link PRIVATE: penerima yang sudah punya sesi valid di perangkat ini
 * dibukakan isinya lewat `/api/share/[slug]/unlock` — server baru
 * merakit payload setelah token terbukti sah. Tanpa token, tidak ada
 * satu byte isi pun yang dikirim.
 */

import React, { useEffect, useState } from "react";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import TagPill from "@/components/tag-pill/TagPill";
import type { SharePayload } from "@/lib/shareTypes";
import styles from "./sharePage.module.css";

export type ShareInvalidKind =
  | "expired"
  | "not-found"
  | "project-gone"
  | "section-gone"
  | "file-gone"
  | "private";

const COPY: Record<ShareInvalidKind, { title: string; text: string }> = {
  expired: {
    title: "Link sudah kedaluwarsa",
    text: "Link ini sudah tidak berlaku. Minta link baru ke tim Shotstash yang membagikannya.",
  },
  "not-found": {
    title: "Link tidak ditemukan",
    text: "Periksa lagi link yang kamu terima, atau minta link baru ke tim Shotstash.",
  },
  "project-gone": {
    title: "Project sudah tidak tersedia",
    text: "Project ini sudah dihapus atau dipindahkan.",
  },
  "section-gone": {
    title: "Section sudah tidak tersedia",
    text: "Section ini sudah dihapus atau dipindahkan.",
  },
  "file-gone": {
    title: "File sudah tidak tersedia",
    text: "File ini sudah dihapus atau dipindahkan.",
  },
  private: {
    title: "Link privat",
    text: "Kamu harus login untuk membuka link ini.",
  },
};

export default function ShareInvalid({
  kind,
  slug,
  sectionId,
  onUnlocked,
}: {
  kind: ShareInvalidKind;
  /** Hanya untuk keadaan PRIVATE — mencoba membuka dengan sesi lokal. */
  slug?: string;
  sectionId?: string | null;
  onUnlocked?: (payload: SharePayload) => void;
}) {
  const [checking, setChecking] = useState(kind === "private" && !!slug && !!onUnlocked);

  useEffect(() => {
    if (kind !== "private" || !slug || !onUnlocked) return;
    let alive = true;
    (async () => {
      let token: string | null = null;
      try {
        token = localStorage.getItem("shotstash_token");
      } catch {
        token = null;
      }
      if (!token) {
        if (alive) setChecking(false);
        return;
      }
      try {
        const q = sectionId ? `?section=${encodeURIComponent(sectionId)}` : "";
        const res = await fetch(`/api/share/${slug}/unlock${q}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!alive) return;
        if (res.ok) {
          const body = (await res.json()) as { state: string; payload: SharePayload };
          if (body.state === "ok") {
            onUnlocked(body.payload);
            return;
          }
        }
      } catch {
        /* Tetap di keadaan privat — tidak ada isi yang ditampilkan. */
      }
      if (alive) setChecking(false);
    })();
    return () => {
      alive = false;
    };
  }, [kind, slug, sectionId, onUnlocked]);

  const copy = COPY[kind];

  return (
    <main className={styles.page} lang="id">
      <div className={styles.topbar}>
        <Logo size="login" />
        <ThemeToggle />
      </div>

      <div className={styles.hero}>
        <div className={styles.stage}>
          <div className={styles.copy}>
            {/* `tag-pill` DIREDUPKAN — panggung tanpa judul dan tanpa nomor. */}
            <div className={`${styles.tagrow} ${styles.tagDim}`}>
              <TagPill>Arsip premium</TagPill>
            </div>
          </div>
          {/* Objek `project-empty` tanpa label: slot pill dibiarkan KOSONG. */}
          <div className={styles.emptyObject} aria-hidden="true">
            <span className={styles.emptyBack} />
            <span className={styles.emptyGhost} />
            <span className={styles.emptyPocket}>
              <span className={styles.emptyLabel} />
            </span>
          </div>
          <div className={styles.fade} aria-hidden="true" />
        </div>

        <div className={styles.card}>
          <p className={`spine-label ${styles.kick}`}>Shotstash</p>
          <h1 className={`spine-display-panel-mobile ${styles.cardTitle}`}>{copy.title}</h1>
          <p className={`spine-body ${styles.cardText}`}>
            {checking ? "Memeriksa akses…" : copy.text}
          </p>
        </div>
      </div>
    </main>
  );
}
