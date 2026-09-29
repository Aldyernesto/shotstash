'use client';
/**
 * Runtime public settings in the browser (Story 6.3): one fetch of
 * `GET /api/v1/config` per page load, shared by every component through a
 * module cache. `null` until it arrives (and after a failed fetch, which is
 * retried on the next mount), so callers hide optional UI until then.
 */
import { useEffect, useState } from 'react';
import type { PublicConfig } from './config';

let cached: PublicConfig | null = null;
let pending: Promise<PublicConfig | null> | null = null;

export function loadPublicConfig(): Promise<PublicConfig | null> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = fetch('/api/v1/config', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<PublicConfig>) : null))
      .catch(() => null)
      .then((value) => {
        cached = value;
        if (!value) pending = null;
        return value;
      });
  }
  return pending;
}

export function usePublicConfig(): PublicConfig | null {
  const [value, setValue] = useState<PublicConfig | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void loadPublicConfig().then((v) => {
      if (alive) setValue(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  return value;
}
