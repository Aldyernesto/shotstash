"use client";

/**
 * Story 5.4: "Processing" inside the viewer info panel / sheet.
 *
 *   - the file's job on a `status-chip` (queued, waiting for worker,
 *     starting, processing n%, ready, failed, cancelled), announced per
 *     stage;
 *   - Cancel for an unfinished job, Retry for a failed one (queues the same
 *     kind again);
 *   - a "Process" menu of the kinds that apply to this file
 *     (`availableKinds`), "Create proxy (720p)" first for videos; a kind no
 *     live worker serves says so (the job then waits for one).
 *
 * The actions need `pipeline.trigger`; without it only the chip shows (the
 * API refuses anyway). Results go up through `onJob`, the same path the
 * project event stream uses, so the chip never jumps back.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import { gql, useMutation, useQuery } from "@apollo/client";
import { useTranslations } from "next-intl";
import styles from "./viewerInfo.module.css";
import { JobChip } from "./JobChip";
import { jobChip } from "@/lib/jobChip";
import { useModalLayer } from "@/components/overlay/modalStack";
import { useHumanizeError, useToast } from "@/components/feedback/ToastProvider";
import { JOB_FIELDS, type UiJob } from "@/components/realtime/fields";

const AVAILABLE_KINDS = gql`
  query AvailableKinds($fileId: ID!) {
    availableKinds(fileId: $fileId) {
      kind
      label
      live
      open
    }
  }
`;

const ENQUEUE = gql`
  mutation EnqueueJob($fileId: ID!, $kind: String!) {
    enqueueJob(fileId: $fileId, kind: $kind) {
      ${JOB_FIELDS}
    }
  }
`;

const CANCEL = gql`
  mutation CancelJob($id: ID!) {
    cancelJob(id: $id) {
      ${JOB_FIELDS}
    }
  }
`;

type KindOption = { kind: string; label?: string | null; live: boolean; open?: boolean };

/** Longest worker error shown (in the collapsed details). */
const MAX_ERROR_CHARS = 300;

export type ViewerProcessProps = {
  fileId: string;
  job: UiJob | null;
  canTrigger: boolean;
  /** Translated kind label (known kinds), else the stored label, else the kind. */
  kindLabel: (v: { kind: string; kindLabel?: string | null }) => string;
  onJob: (job: UiJob) => void;
};

const GearIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

export function ViewerProcess({ fileId, job, canTrigger, kindLabel, onJob }: ViewerProcessProps) {
  const t = useTranslations("jobs");
  const titleId = useId();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const { pushToast } = useToast();
  const humanizeError = useHumanizeError();

  const { data: kindData, loading: kindsLoading } = useQuery(AVAILABLE_KINDS, {
    variables: { fileId },
    skip: !canTrigger,
    fetchPolicy: "cache-and-network",
  });
  const [enqueue] = useMutation(ENQUEUE);
  const [cancel] = useMutation(CANCEL);

  const closeMenu = () => {
    setMenuOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  // Esc closes the menu first (a non-modal layer above the viewer) and focus goes back to "Process".
  useModalLayer(closeMenu, { modal: false, enabled: menuOpen });
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  // On open, focus moves to the first entry.
  useEffect(() => {
    if (menuOpen) items()[0]?.focus({ preventScroll: true });
  }, [menuOpen, kindData]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === "ArrowDown") next = (at + 1) % list.length;
    else if (e.key === "ArrowUp") next = (at - 1 + list.length) % list.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = list.length - 1;
    else if (e.key === "Tab") {
      setMenuOpen(false);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    list[next].focus();
  };

  const kinds: KindOption[] = (kindData?.availableKinds as KindOption[] | undefined) ?? [];
  // Known kinds have a written action ("Create proxy (720p)"); others read "Run {label}".
  const actions = t.raw("actions" as never) as Record<string, string>;
  const actionLabel = (kind: string, label: string) =>
    (Object.prototype.hasOwnProperty.call(actions, kind) ? actions[kind] : null) || t("action", { label });
  const chip = jobChip(job);
  if (!canTrigger && !job) return null;

  const run = async (label: string, work: () => Promise<UiJob | null | undefined>, failKey: "queueFailed" | "cancelFailed") => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await work();
      if (next) onJob(next);
    } catch (err) {
      pushToast({ tone: "error", message: t(failKey, { kind: label }), cause: humanizeError(err) });
    } finally {
      setBusy(false);
    }
  };

  const start = (kind: string, label: string) => {
    closeMenu();
    void run(label, async () => (await enqueue({ variables: { fileId, kind } })).data?.enqueueJob, "queueFailed");
  };

  const jobLabel = job ? kindLabel(job) : "";

  return (
    <section aria-labelledby={titleId} className={styles.versions}>
      <p id={titleId} className={styles.infoLabel}>
        {t("title")}
      </p>

      {job && chip ? (
        <div className={styles.version}>
          <div className={styles.versionText}>
            <span className={`spine-body-sm ${styles.jobKind}`}>{jobLabel}</span>
            <JobChip job={job} kindLabel={jobLabel} announce />
            {chip.labelKey === "failed" && job.error ? (
              <details className={styles.jobError}>
                <summary className="spine-footnote">{t("errorDetails")}</summary>
                <span className={`spine-footnote ${styles.versionMeta}`}>
                  {job.error.length > MAX_ERROR_CHARS ? `${job.error.slice(0, MAX_ERROR_CHARS)}…` : job.error}
                </span>
              </details>
            ) : null}
          </div>
          {canTrigger && chip.open ? (
            <button
              type="button"
              className={`spine-focus-ring ${styles.jobAction}`}
              aria-busy={busy || undefined}
              onClick={() => void run(jobLabel, async () => (await cancel({ variables: { id: job.id } })).data?.cancelJob, "cancelFailed")}
            >
              {t("cancel")}
              <span className="spine-visually-hidden"> {jobLabel}</span>
            </button>
          ) : null}
          {canTrigger && chip.retry ? (
            <button
              type="button"
              className={`spine-focus-ring ${styles.jobAction} ${styles.jobActionAccent}`}
              aria-busy={busy || undefined}
              onClick={() => void run(jobLabel, async () => (await enqueue({ variables: { fileId, kind: job.kind } })).data?.enqueueJob, "queueFailed")}
            >
              {t("retry")}
              <span className="spine-visually-hidden"> {jobLabel}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {canTrigger ? (
        <div className={styles.processWrap}>
          <button
            ref={triggerRef}
            type="button"
            className={`spine-focus-ring ${styles.processButton}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? menuId : undefined}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {GearIcon}
            {t("process")}
          </button>
          {menuOpen ? (
            <div id={menuId} ref={menuRef} role="menu" aria-label={t("process")} className={styles.processMenu} onKeyDown={onMenuKey}>
              {kindsLoading && !kinds.length ? (
                <p className={`spine-footnote ${styles.processEmpty}`}>{t("loadingKinds")}</p>
              ) : kinds.length === 0 ? (
                <p className={`spine-footnote ${styles.processEmpty}`}>{t("noKinds")}</p>
              ) : (
                kinds.map((k) => {
                  const label = kindLabel({ kind: k.kind, kindLabel: k.label });
                  // An unfinished job of this kind already runs for the file: no second one.
                  const running = !!k.open || (!!job && !!chip?.open && job.kind === k.kind);
                  const off = busy || running;
                  return (
                    <button
                      key={k.kind}
                      type="button"
                      role="menuitem"
                      tabIndex={-1}
                      className={styles.processItem}
                      aria-disabled={off || undefined}
                      onClick={() => {
                        if (!off) start(k.kind, label);
                      }}
                    >
                      <span className={styles.processItemLabel}>{actionLabel(k.kind, label)}</span>
                      {running ? (
                        <span className={`spine-footnote ${styles.processItemNote}`}>{t("alreadyOpen")}</span>
                      ) : !k.live ? (
                        <span className={`spine-footnote ${styles.processItemNote}`}>{t("noWorker")}</span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
