import workers from '@/data/community-workers.json';

/** One entry of data/community-workers.json (see the Community workers page). */
export interface CommunityWorker {
  name: string;
  description: string;
  repository: string;
  kinds: string[];
  contract: number;
  license: string;
  maintainer: string;
}

const list = workers as CommunityWorker[];

export function CommunityWorkers() {
  if (list.length === 0) {
    return (
      <div className="not-prose my-6 rounded-xl border border-dashed border-fd-border p-6 text-sm">
        <p className="font-medium text-fd-foreground">No community workers are listed yet.</p>
        <p className="mt-2 text-fd-muted-foreground">
          Yours could be the first: write a worker against the contract, then open a pull request that adds it to{' '}
          <code>docs/data/community-workers.json</code> as described below.
        </p>
      </div>
    );
  }
  return (
    <div className="not-prose my-6 grid gap-3 sm:grid-cols-2">
      {list.map((w) => (
        <a
          key={w.repository}
          href={w.repository}
          className="rounded-xl border border-fd-border bg-fd-card p-4 transition-colors hover:bg-fd-accent"
        >
          <p className="font-medium text-fd-foreground">{w.name}</p>
          <p className="mt-1 text-sm text-fd-muted-foreground">{w.description}</p>
          <p className="mt-2 font-mono text-xs text-fd-muted-foreground">
            {w.kinds.join(', ')} · contract v{w.contract} · {w.license} · {w.maintainer}
          </p>
        </a>
      ))}
    </div>
  );
}
