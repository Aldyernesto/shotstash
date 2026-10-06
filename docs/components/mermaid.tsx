'use client';
import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

/** The diagram's `accTitle:` line, when the chart has one. */
function accTitle(chart: string): string | undefined {
  return /^\s*accTitle:\s*(.+)$/m.exec(chart)?.[1]?.trim();
}

/**
 * Renders a ```mermaid block (turned into <Mermaid chart="..."/> by remarkMdxMermaid).
 * Before the script runs, and when rendering fails, the chart source is shown
 * as a code block, so the content is never lost.
 */
export function Mermaid({ chart, title }: { chart: string; title?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const label = title ?? accTitle(chart) ?? 'Diagram';

  useEffect(() => {
    let cancelled = false;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          fontFamily: 'inherit',
          theme: resolvedTheme === 'light' ? 'default' : 'dark',
        });
        const { svg } = await mermaid.render(`m${id}`, chart);
        if (!cancelled) {
          setSvg(svg);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (!svg || failed) {
    return (
      <figure className="my-6" aria-label={label}>
        {failed ? (
          <figcaption className="mb-2 text-sm text-fd-muted-foreground">
            This diagram could not be drawn; its source is shown instead.
          </figcaption>
        ) : null}
        <pre className="overflow-x-auto rounded-lg border border-fd-border p-4 text-sm">
          <code>{chart}</code>
        </pre>
      </figure>
    );
  }

  return (
    <div
      className="my-6 flex justify-center overflow-x-auto [&_svg]:max-w-full"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
