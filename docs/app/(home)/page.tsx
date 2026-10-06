import Link from 'next/link';
import { asset, productName, repoUrl, tagline } from '@/lib/site';

const sections = [
  { href: '/docs/quick-start/', title: 'Quick start', text: 'From a fresh Linux machine to your first upload with Docker Compose.' },
  { href: '/docs/configuration/', title: 'Configure', text: 'Every environment variable, generated from the code.' },
  { href: '/docs/networking/', title: 'Networking and backup', text: 'Reverse proxies, tunnels, backups, upgrades and rollback.' },
  { href: '/docs/api/', title: 'API reference', text: 'GraphQL and REST, generated from the committed schema files.' },
  { href: '/docs/byo-ai/', title: 'Bring your own AI', text: 'Plug any model or tool into the job pipeline over HTTP.' },
  { href: '/docs/user-guide/', title: 'User guide', text: 'Projects, uploads, the viewer, sharing, roles and discussion.' },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-16 md:py-24">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset('/brand/icon.svg')} alt="" width={56} height={56} className="mb-6 rounded-xl" />
      <h1 className="font-display text-4xl tracking-tight md:text-6xl">{productName}</h1>
      <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">{tagline}</p>
      <p className="mt-2 max-w-2xl text-fd-muted-foreground">
        MIT licensed. There is no paid tier and nothing is held back: everything lives in the repository.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/docs/quick-start/"
          className="rounded-lg bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground"
        >
          Get started
        </Link>
        <a href={repoUrl} className="rounded-lg border border-fd-border px-4 py-2 font-medium">
          GitHub
        </a>
      </div>
      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-xl border border-fd-border bg-fd-card p-5 transition-colors hover:bg-fd-accent"
          >
            <p className="font-medium">{s.title}</p>
            <p className="mt-1 text-sm text-fd-muted-foreground">{s.text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
