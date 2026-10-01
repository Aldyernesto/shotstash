'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useFormat } from '@/i18n/useFormat';
import { StatusChip } from '@/components/form/StatusChip';
import { PillButton } from '@/components/form/buttons';
import { ConfirmDialog } from '@/components/overlay/Dialog';
import styles from './status.module.css';

type JobCounts = {
  queued: number;
  waitingForWorker: number;
  claimed: number;
  running: number;
  done24h: number;
  failed24h: number;
  cancelled24h: number;
};

type Status = {
  version: string;
  storage: { backend: 'local' | 's3'; reachable: boolean };
  database: boolean;
  cache: boolean;
  search: boolean;
  workers: number | null;
  queuedJobs: number | null;
  jobs: JobCounts | null;
};

type Worker = {
  id: string;
  name: string;
  version: string;
  kinds: string[];
  live: boolean;
  lastSeen: string;
  revokedAt: string | null;
};

type State = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'failed' } | { kind: 'ready'; status: Status };

/** Story 5.4: the figures refresh this often while the page is open. */
const REFRESH_MS = 10_000;

const WORKERS = 'query StatusWorkers { pipelineWorkers { id name version kinds live lastSeen revokedAt } }';
const REVOKE = 'mutation RevokeWorker($id: ID!) { revokeWorker(id: $id) { id revokedAt live } }';

function authHeaders(): Record<string, string> {
  let token = '';
  try {
    token = localStorage.getItem('shotstash_token') ?? '';
  } catch {}
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0]?.extensions?.code ?? 'INTERNAL');
  return body.data as T;
}

export default function StatusView() {
  const t = useTranslations('status');
  const f = useFormat();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [workersFailed, setWorkersFailed] = useState(false);
  const [revoking, setRevoking] = useState<Worker | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeFailed, setRevokeFailed] = useState(false);
  const hidden = useRef(false);

  const load = useCallback(async () => {
    try {
      // Without a session the API answers 401, which hides the page like any other refusal.
      const res = await fetch('/api/v1/status', { headers: authHeaders(), cache: 'no-store' });
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        hidden.current = true;
        setState({ kind: 'hidden' });
        return;
      }
      if (!res.ok) {
        setState((s) => (s.kind === 'ready' ? s : { kind: 'failed' }));
        return;
      }
      setState({ kind: 'ready', status: (await res.json()) as Status });
    } catch {
      setState((s) => (s.kind === 'ready' ? s : { kind: 'failed' }));
    }
    try {
      const data = await graphql<{ pipelineWorkers: Worker[] }>(WORKERS);
      setWorkers(data.pipelineWorkers);
      setWorkersFailed(false);
    } catch {
      setWorkersFailed(true);
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => {
      if (!hidden.current && document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  if (state.kind === 'hidden') notFound();

  const confirmRevoke = async () => {
    if (!revoking) return;
    setBusy(true);
    setRevokeFailed(false);
    try {
      await graphql(REVOKE, { id: revoking.id });
      setRevoking(null);
      await load();
    } catch {
      // The dialog fires once; close it and say so above the list.
      setRevoking(null);
      setRevokeFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const reach = (ok: boolean) => (ok ? t('reachable') : t('unreachable'));
  const tiles =
    state.kind === 'ready'
      ? [
          { key: 'version', label: t('version'), value: state.status.version },
          { key: 'backend', label: t('storageBackend'), value: state.status.storage.backend === 's3' ? t('backendS3') : t('backendLocal') },
          { key: 'storage', label: t('storage'), value: reach(state.status.storage.reachable), bad: !state.status.storage.reachable },
          { key: 'database', label: t('database'), value: reach(state.status.database), bad: !state.status.database },
          { key: 'cache', label: t('cache'), value: reach(state.status.cache), bad: !state.status.cache },
          { key: 'search', label: t('search'), value: state.status.search ? t('searchOn') : t('searchOff') },
          { key: 'workers', label: t('workers'), value: state.status.workers ?? t('notAvailable') },
          { key: 'jobs', label: t('queuedJobs'), value: state.status.queuedJobs ?? t('notAvailable') },
        ]
      : [];

  const jobs = state.kind === 'ready' ? state.status.jobs : null;
  const queueTiles = jobs
    ? [
        { key: 'queued', label: t('queue.queued'), value: jobs.queued },
        { key: 'waiting', label: t('queue.waitingForWorker'), value: jobs.waitingForWorker },
        { key: 'claimed', label: t('queue.claimed'), value: jobs.claimed },
        { key: 'running', label: t('queue.running'), value: jobs.running },
        { key: 'done', label: t('queue.done24h'), value: jobs.done24h },
        { key: 'failed', label: t('queue.failed24h'), value: jobs.failed24h, bad: jobs.failed24h > 0 },
        { key: 'cancelled', label: t('queue.cancelled24h'), value: jobs.cancelled24h },
      ]
    : [];

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={`spine-display-page ${styles.pageTitle}`}>{t('title')}</h1>
        <p className={`spine-body ${styles.pageSub}`}>{t('subtitle')}</p>
      </div>
      <section className={styles.panel} aria-labelledby="status-panel-title" aria-busy={state.kind === 'loading' || undefined}>
        <h2 id="status-panel-title" className={`spine-display-panel ${styles.panelTitle}`}>
          {t('panelTitle')}
        </h2>
        {state.kind === 'loading' && <p className={`spine-footnote ${styles.note}`}>{t('loading')}</p>}
        {state.kind === 'failed' && (
          <p className={`spine-footnote ${styles.note}`} role="alert">
            {t('loadFailed')}
          </p>
        )}
        {state.kind === 'ready' && (
          <div className={styles.stats}>
            {tiles.map((tile) => (
              <p key={tile.key} className={styles.statTile}>
                <span className={`spine-label ${styles.statLabel}`}>{tile.label}</span>
                <span className={`spine-display-card ${styles.statValue} ${tile.bad ? styles.statBad : ''}`}>{tile.value}</span>
              </p>
            ))}
          </div>
        )}
      </section>

      {state.kind === 'ready' && (
        <section className={styles.panel} aria-labelledby="status-queue-title">
          <h2 id="status-queue-title" className={`spine-display-panel ${styles.panelTitle}`}>
            {t('queue.title')}
          </h2>
          {jobs ? (
            <div className={styles.stats}>
              {queueTiles.map((tile) => (
                <p key={tile.key} className={styles.statTile}>
                  <span className={`spine-label ${styles.statLabel}`}>{tile.label}</span>
                  <span className={`spine-display-card ${styles.statValue} ${tile.bad ? styles.statBad : ''}`}>
                    {f.number(tile.value)}
                  </span>
                </p>
              ))}
            </div>
          ) : (
            <p className={`spine-footnote ${styles.note}`}>{t('notAvailable')}</p>
          )}
        </section>
      )}

      {state.kind === 'ready' && (
        <section className={styles.panel} aria-labelledby="status-workers-title">
          <h2 id="status-workers-title" className={`spine-display-panel ${styles.panelTitle}`}>
            {t('workerList.title')}
          </h2>
          {revokeFailed ? (
            <p className={`spine-footnote ${styles.note} ${styles.statBad}`} role="alert">
              {t('workerList.revokeFailed')}
            </p>
          ) : null}
          {workersFailed && !workers ? (
            <p className={`spine-footnote ${styles.note}`} role="alert">
              {t('workerList.loadFailed')}
            </p>
          ) : workers && workers.length === 0 ? (
            <p className={`spine-footnote ${styles.note}`}>{t('workerList.empty')}</p>
          ) : workers ? (
            <ul className={styles.workers}>
              {workers.map((w) => (
                <li key={w.id} className={styles.worker}>
                  <div className={styles.workerMain}>
                    <b className={`spine-chip ${styles.workerName}`}>{w.name}</b>
                    <span className={`spine-footnote ${styles.workerMeta}`}>
                      {t('workerList.version', { version: w.version })}
                      {' · '}
                      {t('workerList.lastSeen', { time: f.dateTime(w.lastSeen) })}
                    </span>
                    <span className={styles.workerKinds}>
                      {w.kinds.map((k) => (
                        <code key={k} className={`spine-footnote ${styles.kind}`}>
                          {k}
                        </code>
                      ))}
                    </span>
                  </div>
                  <div className={styles.workerSide}>
                    {w.revokedAt ? (
                      <StatusChip tone="danger">{t('workerList.revoked')}</StatusChip>
                    ) : w.live ? (
                      <StatusChip tone="ok">{t('workerList.live')}</StatusChip>
                    ) : (
                      <StatusChip tone="neutral">{t('workerList.offline')}</StatusChip>
                    )}
                    {!w.revokedAt ? (
                      <PillButton
                        variant="surface"
                        onClick={() => {
                          setRevokeFailed(false);
                          setRevoking(w);
                        }}
                        aria-label={t('workerList.revokeName', { name: w.name })}
                      >
                        {t('workerList.revoke')}
                      </PillButton>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`spine-footnote ${styles.note}`}>{t('loading')}</p>
          )}
        </section>
      )}

      {revoking && (
        <ConfirmDialog
          tone="permanent"
          title={t('workerList.confirmTitle', { name: revoking.name })}
          lead={t('workerList.confirmLead')}
          confirmLabel={t('workerList.revoke')}
          busy={busy}
          onConfirm={() => void confirmRevoke()}
          onClose={() => setRevoking(null)}
        />
      )}
    </main>
  );
}
