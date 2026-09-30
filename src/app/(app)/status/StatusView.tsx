'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import styles from './status.module.css';

type Status = {
  version: string;
  storage: { backend: 'local' | 's3'; reachable: boolean };
  database: boolean;
  cache: boolean;
  search: boolean;
  workers: number | null;
  queuedJobs: number | null;
};

type State = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'failed' } | { kind: 'ready'; status: Status };

export default function StatusView() {
  const t = useTranslations('status');
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let token = '';
    try {
      token = localStorage.getItem('shotstash_token') ?? '';
    } catch {}
    // Without a session the API answers 401, which hides the page like any other refusal.
    fetch('/api/v1/status', { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403 || res.status === 404) return setState({ kind: 'hidden' });
        if (!res.ok) return setState({ kind: 'failed' });
        setState({ kind: 'ready', status: (await res.json()) as Status });
      })
      .catch(() => setState({ kind: 'failed' }));
  }, []);

  if (state.kind === 'hidden') notFound();

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
        {state.kind === 'ready' && <p className={`spine-footnote ${styles.note}`}>{t('pipelineNote')}</p>}
      </section>
    </main>
  );
}
