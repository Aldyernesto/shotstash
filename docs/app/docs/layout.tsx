import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.getPageTree(i18n.defaultLanguage)} {...baseOptions()}>
      {children}
    </DocsLayout>
  );
}
