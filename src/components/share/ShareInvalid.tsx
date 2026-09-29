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
import { useTranslations } from "next-intl";
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
  | "revoked"
  | "not-found"
  | "project-gone"
  | "section-gone"
  | "file-gone"
  | "private";

/** Message keys (`shareInvalid.<key>.title|text`) per state. */
const COPY_KEY: Record<
  ShareInvalidKind,
  "expired" | "revoked" | "notFound" | "projectGone" | "sectionGone" | "fileGone" | "private"
> = {
  expired: "expired",
  revoked: "revoked",
  "not-found": "notFound",
  "project-gone": "projectGone",
  "section-gone": "sectionGone",
  "file-gone": "fileGone",
  private: "private",
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
  const t = useTranslations("shareInvalid");
  const tc = useTranslations("common");
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
      // Rendered by the stable `code` of the answer, never by its text.
      if (body?.code === "RATE_LIMITED" || res.status === 429) {
        const minutes = Math.max(1, Math.ceil((body?.retryAfter ?? 60) / 60));
        setError(t("rateLimited", { minutes }));
      } else if (body?.code === "INVALID_CODE") {
        setError(t("wrongCode"));
      } else if (res.ok) {
        // The link died between page load and unlock: reload to show why.
        window.location.reload();
      } else {
        setError(t("inactive"));
      }
    } catch {
      setError(t("offline"));
    } finally {
      setBusy(false);
    }
  };

  const key = COPY_KEY[kind];
  const productName = brand.productName;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Logo size="login" />
        <ThemeToggle />
      </div>

      <div className={styles.hero}>
        <div className={styles.stage}>
          <div className={styles.copy}>
            {/* `tag-pill` DIREDUPKAN — panggung tanpa judul dan tanpa nomor. */}
            <div className={`${styles.tagrow} ${styles.tagDim}`}>
              <TagPill>{tc("archiveTag")}</TagPill>
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
          <h1 className={`spine-display-panel-mobile ${styles.cardTitle}`}>{t(`${key}.title`)}</h1>
          <p className={`spine-body ${styles.cardText}`}>{t(`${key}.text`, { productName })}</p>
          {canUnlock ? (
            <form className={styles.unlockForm} onSubmit={unlock} noValidate>
              <TextField
                label={t("codeLabel")}
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
              <ButtonPrimary type="submit" busy={busy} busyLabel={t("checking")} disabled={!code.trim()}>
                {t("open")}
              </ButtonPrimary>
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
