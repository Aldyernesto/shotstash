'use client';
/**
 * Story 8.2: the read-only demo accounts on the sign-in page of a public
 * demo instance (demo mode only; the data comes from GET /api/v1/config).
 * Picking an account fills the sign-in form.
 */
import { useTranslations } from 'next-intl';
import type { PublicConfig } from '@/lib/config';
import styles from './DemoAccounts.module.css';

type Demo = NonNullable<PublicConfig['demo']>;

export default function DemoAccounts({ demo, onPick }: { demo: Demo; onPick: (email: string, password: string) => void }) {
  const t = useTranslations('demo');
  const roleLabel = (role: string) =>
    role === 'ADMIN' || role === 'EDITOR' || role === 'VIEWER' ? t(`role.${role}`) : role;
  return (
    <section className={styles.box} aria-labelledby="demo-accounts-title">
      <h2 id="demo-accounts-title" className={`spine-label ${styles.title}`}>
        {t('signInTitle')}
      </h2>
      <p className={`spine-footnote ${styles.body}`}>
        {t.rich('signInBody', { password: demo.password, code: (chunks) => <code>{chunks}</code> })}
      </p>
      <ul className={styles.list}>
        {demo.accounts.map((a) => (
          <li key={a.email}>
            <button
              type="button"
              className={`spine-focus-ring ${styles.account}`}
              onClick={() => onPick(a.email, demo.password)}
              aria-label={t('useAccount', { role: roleLabel(a.role), email: a.email })}
            >
              <span className={styles.role}>{roleLabel(a.role)}</span>
              <span className={styles.email}>{a.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
