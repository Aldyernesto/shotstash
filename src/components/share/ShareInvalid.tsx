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
 * PRIVATE links (Story 2.3): the visitor types the access code the link's
 * creator shared; `POST /s/<slug>/unlock` checks it, sets the
 * `shotstash_share_<slug>` cookie and only then answers the payload.
 * Without the code not one byte of content is sent.
 */

import React, { useState } from "react";
import Logo from "@/components/Logo";
import { brand } from "@/lib/brand";
import ThemeToggle from "@/components/ThemeToggle";
import TagPill from "@/components/tag-pill/TagPill";
import TextField from "@/components/form/TextField";
import { ButtonPrimary } from "@/components/form/buttons";
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
    text: "Masukkan kode akses dari orang yang membagikan link ini.",
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
  const canUnlock = kind === "private" && !!slug;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/s/${slug}/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, section: sectionId ?? null }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { state?: string; payload?: SharePayload; code?: string; retryAfter?: number }
        | null;
      if (res.ok && body?.state === "ok" && body.payload) {
        if (onUnlocked) onUnlocked(body.payload);
        else window.location.reload();
        return;
      }
      if (res.status === 429) {
        const minutes = Math.max(1, Math.ceil((body?.retryAfter ?? 60) / 60));
        setError(`Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`);
      } else if (res.status === 401) {
        setError("Kode akses salah.");
      } else if (res.ok) {
        // The link died between page load and unlock: reload to show why.
        window.location.reload();
      } else {
        setError("Link ini sudah tidak berlaku.");
      }
    } catch {
      setError("Sambungan ke server terputus. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

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
          <p className={`spine-label ${styles.kick}`}>{brand.productName}</p>
          <h1 className={`spine-display-panel-mobile ${styles.cardTitle}`}>{copy.title}</h1>
          <p className={`spine-body ${styles.cardText}`}>{copy.text}</p>
          {canUnlock ? (
            <form onSubmit={unlock} noValidate>
              <TextField
                label="Kode akses"
                name="accessCode"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                error={error}
                required
              />
              <ButtonPrimary type="submit" busy={busy} busyLabel="Memeriksa..." disabled={!code.trim()}>
                Buka link
              </ButtonPrimary>
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
