import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { asset, productName, repoUrl } from './site';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('/brand/logo-on-dark.svg')} alt={productName} className="hidden h-6 w-auto dark:block" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('/brand/logo-on-light.svg')} alt={productName} className="block h-6 w-auto dark:hidden" />
        </>
      ),
      url: '/',
    },
    githubUrl: repoUrl,
    links: [
      { text: 'Docs', url: '/docs/', active: 'nested-url' },
      { text: 'API', url: '/docs/api/', active: 'nested-url' },
      { text: 'User guide', url: '/docs/user-guide/', active: 'nested-url' },
    ],
  };
}
