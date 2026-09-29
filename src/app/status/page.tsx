/**
 * Instance status (Story 6.1): version, storage backend and reachability,
 * database, cache, and the pipeline figures once workers exist (Epic 5).
 * Super admin only: the data comes from `GET /api/v1/status`, which answers
 * 404 to everyone else, and this page then renders the not-found page.
 *
 * The shell is a server component; the figures load in the browser because
 * the session travels as a Bearer token (the session cookie is scoped to
 * `/media`, AD-4), so the server cannot identify the viewer of a page.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { brand } from '@/lib/brand';
import StatusView from './StatusView';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('status');
  return { title: t('metaTitle', { productName: brand.productName }), robots: { index: false } };
}

export default function StatusPage() {
  return <StatusView />;
}
