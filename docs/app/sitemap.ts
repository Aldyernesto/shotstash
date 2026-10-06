import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { siteUrl } from '@/lib/site';

export const dynamic = 'force-static';

/** Every page of the site, at its public address. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages(i18n.defaultLanguage).map((page) => `${siteUrl}${page.url.replace(/^\/+/, '')}/`.replace(/\/+$/, '/'));
  return [siteUrl, ...pages].map((url) => ({ url }));
}
