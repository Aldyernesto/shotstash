import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

// Static export: the search index is written once at build time.
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  language: 'english',
});
