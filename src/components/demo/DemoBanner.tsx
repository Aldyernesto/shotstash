'use client';
/**
 * Story 8.2: slim notice at the top of the app on a public demo instance
 * (`features.demo` from GET /api/v1/config). Renders nothing elsewhere.
 */
import { useTranslations } from 'next-intl';
import { usePublicConfig } from '@/lib/usePublicConfig';
import styles from './DemoBanner.module.css';

export default function DemoBanner() {
  const t = useTranslations('demo');
  const publicConfig = usePublicConfig();
  if (!publicConfig?.features.demo) return null;
  return (
    <div className={`spine-footnote ${styles.banner}`} role="note">
      {t('banner')}
    </div>
  );
}
