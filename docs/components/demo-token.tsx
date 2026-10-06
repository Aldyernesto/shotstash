'use client';
import { useState } from 'react';
import { demoOrigin } from '@/lib/site';

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; token: string; expiresAt: string }
  | { kind: 'error'; message: string };

/**
 * Story 8.2: a short read-only session of the public demo for the try-it
 * console (`POST /api/v1/demo/session`). Renders nothing in a build without
 * DEMO_ORIGIN.
 */
export function DemoToken() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  if (!demoOrigin) return null;

  async function fetchToken() {
    setState({ kind: 'busy' });
    setCopied(false);
    try {
      const res = await fetch(`${demoOrigin}/api/v1/demo/session`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { token?: string; expiresAt?: string; code?: string };
      if (!res.ok || !body.token || !body.expiresAt || Number.isNaN(Date.parse(body.expiresAt))) {
        setState({
          kind: 'error',
          message: body.code === 'RATE_LIMITED' ? 'Too many tokens from this address; try again later.' : 'The demo did not answer; try again later.',
        });
        return;
      }
      setState({ kind: 'done', token: body.token, expiresAt: body.expiresAt });
    } catch {
      setState({ kind: 'error', message: 'The demo could not be reached.' });
    }
  }

  return (
    <div className="not-prose my-6 rounded-xl border bg-fd-card p-4 text-sm">
      <p className="mb-3 text-fd-muted-foreground">
        Try the REST routes against the public demo at <code>{demoOrigin}</code>. Get a read-only token (valid for 60 minutes), then paste it
        as the Bearer token in the console of any route.
      </p>
      <button
        type="button"
        onClick={fetchToken}
        disabled={state.kind === 'busy'}
        className="rounded-lg bg-fd-primary px-3 py-1.5 font-medium text-fd-primary-foreground disabled:opacity-60"
      >
        {state.kind === 'busy' ? 'Getting a token...' : 'Get a demo token'}
      </button>
      {state.kind === 'done' && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="break-all rounded bg-fd-muted px-2 py-1">{state.token}</code>
          <button
            type="button"
            className="rounded-lg border px-2 py-1"
            onClick={() => {
              // A denied or missing clipboard leaves the token selectable by hand.
              navigator.clipboard?.writeText(state.token).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <span className="text-fd-muted-foreground">expires {new Date(state.expiresAt).toLocaleTimeString()}</span>
        </div>
      )}
      {state.kind === 'error' && <p className="mt-3 text-red-500">{state.message}</p>}
    </div>
  );
}
