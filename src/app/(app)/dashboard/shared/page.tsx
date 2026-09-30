"use client";

/**
 * Story 3.22 — Halaman Shared: `link-row`, salin tautan, cabut akses.
 *
 * Lapisan bersama yang DIPAKAI APA ADANYA (tidak dibangun ulang di sini):
 *   `copy-pill`      → Story 3.2 (satu-satunya sumbernya)
 *   `toast`          → Story 3.2 (`useToast` + `humanizeError`)
 *   `confirm-dialog` → Story 3.1 (dialog desktop / confirm-sheet HP)
 *   `button-danger`  → Story 1.14
 *   `status-chip`    → Story 1.15
 *   `rep-thumb`      → Story 2.14; real thumbnails from `ShareLink.repThumbs` (Story 4.5)
 *   `empty-state` / `skeleton-row` / `error-box` → Story 2.8 + 3.2
 *
 * Tiga call site yang DIMILIKI story ini dan sekarang bersih:
 *   :37 `confirm()`  → ConfirmDialog
 *   :43 `alert()`    → toast error
 *   :50 `alert()`    → toast sukses lewat CopyPill
 */

import React, { useMemo, useState } from "react";
import styles from "./page.module.css";
import { gql, useQuery, useMutation } from "@apollo/client";
import RepThumb, { type RepThumbProps, type RepThumbVariant } from "@/components/dashboard/RepThumb";
import type { RepFile } from "@/components/dashboard/ProjectCard";
import { CopyPill } from "@/components/feedback/CopyPill";
import { useTranslations } from "next-intl";
import { useToast, useHumanizeError } from "@/components/feedback/ToastProvider";
import { ConfirmDialog } from "@/components/overlay/Dialog";
import { ButtonDanger } from "@/components/form/buttons";
import { StatusChip } from "@/components/form/StatusChip";
import { EmptyState, SkeletonRow, ErrorBox } from "@/components/dashboard/states";
import TagPill from "@/components/tag-pill/TagPill";
import { useFormat } from "@/i18n/useFormat";
import { parseSectionName } from "@/lib/sectionNumber";

const GET_SHARE_LINKS = gql`
  query GetShareLinks {
    shareLinks {
      id
      slug
      url
      mode
      expiresAt
      accessCount
      createdAt
      targetType
      targetName
      repThumbs(limit: 3) {
        id
        kind
        thumbnailUrl
        duration
        extension
      }
    }
  }
`;

const REVOKE_SHARE_LINK = gql`
  mutation RevokeShareLink($id: ID!) {
    revokeShareLink(id: $id)
  }
`;

type ShareLinkRow = {
  id: string;
  slug: string;
  url: string;
  mode: string;
  expiresAt?: string | null;
  accessCount: number;
  createdAt: string;
  targetType: string;
  /** Null when the target was deleted. */
  targetName: string | null;
  /** 1-3 representative files of the target (Story 2.4 daily sample). */
  repThumbs?: RepFile[] | null;
};

/* Ikon garis — semuanya `aria-hidden`, arti selalu ada di teksnya. */
const ICON_GLOBE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
  </svg>
);
const ICON_LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </svg>
);
const ICON_INFINITY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M8.5 9.5a3.2 3.2 0 1 0 0 5c2.2 0 3.3-5 5.5-5a3.2 3.2 0 1 1 0 5c-2.2 0-3.3-5-5.5-5z" />
  </svg>
);
const ICON_REVOKE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6.2 6.2l11.6 11.6" />
  </svg>
);

/** App terms: "folder" is the old name of a Section. Keys of `shared.type`. */
const TYPE_KEY: Record<string, "project" | "section" | "file"> = {
  project: "project",
  folder: "section",
  file: "file",
};

const THUMB_VARIANT: Record<string, RepThumbVariant> = {
  project: "project",
  folder: "section",
  file: "file",
};

/**
 * Fallback `rep-thumb` when the target has no thumbnail: the right shape per
 * level (one card for a file, a stack of three for a Section, the fanned
 * pocket for a Project) filled with `{colors.rep-placeholder}`. Deliberately
 * not `empty` (hatched ghost slot = "nothing inside yet").
 */
const REP_PLACEHOLDER: RepFile[] = [
  { id: "ph-1", kind: "photo", thumbnailUrl: null },
  { id: "ph-2", kind: "photo", thumbnailUrl: null },
  { id: "ph-3", kind: "photo", thumbnailUrl: null },
];

/** Story 4.5: the row's real thumbnails (at most 3; the server clamps the limit too). */
function thumbFor(link: ShareLinkRow): Pick<RepThumbProps, "repFiles" | "file"> {
  const thumbs = link.repThumbs ?? [];
  if (link.targetType === "file") return { file: thumbs[0] ?? REP_PLACEHOLDER[0] };
  return { repFiles: thumbs.length ? thumbs : REP_PLACEHOLDER };
}

export default function SharedLinksPage() {
  const { data, loading, error, refetch } = useQuery(GET_SHARE_LINKS, {
    fetchPolicy: "cache-and-network",
  });
  const [revokeShareLink] = useMutation(REVOKE_SHARE_LINK);
  const { pushToast } = useToast();
  const t = useTranslations("shared");
  const tc = useTranslations("common");
  const humanize = useHumanizeError();

  /** Baris yang sedang dikonfirmasi pencabutannya (null = tidak ada dialog). */
  const [pending, setPending] = useState<ShareLinkRow | null>(null);
  const [busy, setBusy] = useState(false);
  /** Pengumuman polite hasil aksi — tidak memindahkan fokus. */
  const [announce, setAnnounce] = useState("");

  const links: ShareLinkRow[] = useMemo(() => data?.shareLinks ?? [], [data]);

  const runRevoke = async () => {
    if (!pending) return;
    const row = pending;
    setBusy(true);
    try {
      await revokeShareLink({ variables: { id: row.id } });
      await refetch();
      setPending(null);
      setAnnounce(t("revokedAnnounce", { path: `/s/${row.slug}` }));
      pushToast({ tone: "success", message: t("revokedToast") });
    } catch (err) {
      console.error("Revoke share link failed", err);
      setPending(null);
      pushToast({
        tone: "error",
        message: t("revokeFailed"),
        cause: humanize(err),
      });
    } finally {
      setBusy(false);
    }
  };

  const count = links.length;

  return (
    <div className={styles.container}>
      <div className={styles.pageHead}>
        <h1 className={`${styles.pageTitle} spine-display-page`}>
          <span className={styles.pageTitleText}>{t("title")}</span>
          {count > 0 ? <TagPill>{t("linkCount", { count })}</TagPill> : null}
        </h1>
        <p className={`${styles.pageSub} spine-body-sub`}>
          {t("subtitle")}
        </p>
      </div>

      <p className="spine-visually-hidden" role="status">
        {announce}
      </p>

      {loading && !data ? (
        <div className={styles.loadingBlock}>
          <p className={`${styles.loadingText} spine-body`}>{t("loading")}</p>
          <SkeletonRow rows={3} variant="card" />
        </div>
      ) : error ? (
        <ErrorBox
          title={t("errorTitle")}
          text={t("errorText")}
          onRetry={() => void refetch()}
        />
      ) : count === 0 ? (
        <EmptyState
          variant="ghost"
          title={t("emptyTitle")}
          text={t("emptyText")}
        />
      ) : (
        <div className={styles.table} role="table" aria-label={t("tableLabel")}>
          <div className={styles.headRow} role="row">
            <span role="columnheader" className={`${styles.headCell} spine-label`}>
              {t("column.content")}
            </span>
            <span role="columnheader" className={`${styles.headCell} spine-label`}>
              {t("column.link")}
            </span>
            <span role="columnheader" className={`${styles.headCell} spine-label`}>
              {t("column.mode")}
            </span>
            <span role="columnheader" className={`${styles.headCell} spine-label`}>
              {t("column.views")}
            </span>
            <span role="columnheader" className={`${styles.headCell} spine-label`}>
              {t("column.expires")}
            </span>
            <span role="columnheader" className="spine-visually-hidden">
              {t("column.actions")}
            </span>
          </div>

          {links.map((link) => (
            <LinkRow key={link.id} link={link} onRevoke={() => setPending(link)} />
          ))}
        </div>
      )}

      {pending ? (
        <ConfirmDialog
          title={tc("revokeLinkTitle")}
          lead={t("confirmLead")}
          tone="permanent"
          confirmLabel={tc("revokeLink")}
          busyLabel={t("revoking")}
          busy={busy}
          icon={<span className={styles.confirmIcon}>{ICON_REVOKE}</span>}
          preview={{
            thumb: (
              <RepThumb
                variant={THUMB_VARIANT[pending.targetType] ?? "file"}
                {...thumbFor(pending)}
                gone={isGone(pending.targetName)}
                size="sm"
              />
            ),
            name: displayName(pending, t),
            meta: t("confirmMeta", {
              path: `/s/${pending.slug}`,
              mode: modeLabel(pending.mode, t),
              count: pending.accessCount,
            }),
          }}
          onConfirm={() => void runRevoke()}
          onClose={() => (busy ? undefined : setPending(null))}
        />
      ) : null}
    </div>
  );
}

type SharedT = ReturnType<typeof useTranslations<"shared">>;

/** The resolver answers a null name once the target is deleted. */
function isGone(name: string | null): boolean {
  return name === null;
}

function displayName(link: ShareLinkRow, t: SharedT): string {
  if (link.targetName !== null) return link.targetName;
  const key = TYPE_KEY[link.targetType];
  return key ? t(`deleted.${key}`) : t("deleted.unknown");
}

function modeLabel(mode: string, t: SharedT): string {
  return mode === "PUBLIC" ? t("modePublic") : t("modePrivate");
}

/**
 * `link-row` — baris kartu min 96 px, kolom tetap
 * Konten · Tautan · Mode · Dilihat · Kedaluwarsa · Aksi.
 * Di bawah 900 px baris yang sama berubah menjadi kartu tiga lapis
 * (kolom jadi baris ber-label) — DOM-nya satu, hanya CSS-nya beralih.
 */
function LinkRow({ link, onRevoke }: { link: ShareLinkRow; onRevoke: () => void }) {
  const t = useTranslations("shared");
  const tc = useTranslations("common");
  const f = useFormat();
  const gone = isGone(link.targetName);
  const name = displayName(link, t);
  const typeKey = TYPE_KEY[link.targetType];
  const type = typeKey ? t(`type.${typeKey}`) : t("type.unknown");
  const isPublic = link.mode === "PUBLIC";
  const section = !gone && link.targetType === "folder" ? parseSectionName(name) : null;

  return (
    <div className={styles.row} role="row">
      <div className={`${styles.cell} ${styles.cellContent}`} role="cell">
        <RepThumb
          variant={THUMB_VARIANT[link.targetType] ?? "file"}
          {...thumbFor(link)}
          gone={gone}
          className={styles.rowThumb}
        />
        <div className={styles.nameBlock}>
          <span className={styles.titleLine}>
            {/* Story 4.5 (key-shared): a numbered Section shows its number sticker. */}
            {section?.number ? (
              <span className={`spine-display-label ${styles.numberSticker}`}>
                <span className={styles.numberPrefix} aria-hidden="true">
                  {tc("numberPrefix")}
                </span>
                <span className="spine-visually-hidden">{tc("number")}</span> {section.number}
              </span>
            ) : null}
            <span className={`${styles.rowName} ${gone ? styles.rowNameGone : ""} spine-row-title`}>
              {section ? section.title : name}
            </span>
          </span>
          <span className={styles.rowMeta}>
            <span className={`${styles.typeChip} spine-chip`}>{type}</span>
          </span>
        </div>
      </div>

      <div className={`${styles.cell} ${styles.cellLink}`} role="cell">
        <CopyPill slug={link.slug} href={link.url} className={styles.copyCell} />
      </div>

      {/* Tiga kolom fakta. `role="presentation"` + `display:contents`
          menjaga ketiganya tetap sel langsung baris ini di pohon
          aksesibilitas; di HP pembungkusnya menjadi lapis kedua kartu. */}
      <div className={styles.facts} role="presentation">
        <div className={`${styles.cell} ${styles.cellFact}`} role="cell">
          <StatusChip tone="neutral" icon={isPublic ? ICON_GLOBE : ICON_LOCK}>
            {modeLabel(link.mode, t)}
          </StatusChip>
        </div>

        <div className={`${styles.cell} ${styles.cellFact}`} role="cell">
          <span className={styles.views}>
            {t.rich("views", {
              count: link.accessCount,
              figure: (chunks) => <b className="spine-row-title">{chunks}</b>,
              unit: (chunks) => <small className={`${styles.viewsUnit} spine-footnote`}>{chunks}</small>,
            })}
          </span>
        </div>

        <div className={`${styles.cell} ${styles.cellFact}`} role="cell">
        {link.expiresAt ? (
          <span className={styles.expiry}>
            <b className={`${styles.expiryDate} spine-body`}>{f.date(link.expiresAt)}</b>
            <small className={`${styles.expiryTime} spine-footnote`}>
              {f.time(link.expiresAt)}
            </small>
          </span>
        ) : (
          <span className={`${styles.permanent} spine-body`}>
            <span className={styles.permanentIcon} aria-hidden="true">
              {ICON_INFINITY}
            </span>
            {t("permanent")}
          </span>
        )}
        </div>
      </div>

      <div className={`${styles.cell} ${styles.cellAction}`} role="cell">
        <ButtonDanger
          variant="outline"
          className={styles.revokeBtn}
          onClick={onRevoke}
          aria-label={t("revokeLabel", { path: `/s/${link.slug}` })}
        >
          <span className={styles.revokeIcon} aria-hidden="true">
            {ICON_REVOKE}
          </span>
          {tc("revokeLink")}
        </ButtonDanger>
      </div>
    </div>
  );
}
