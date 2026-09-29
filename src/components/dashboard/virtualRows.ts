"use client";

/**
 * Story 4.5: window virtualisation for large Sections. Above
 * `VIRTUALIZE_ABOVE` items the file grid and the list view render only the
 * rows near the viewport (the page itself scrolls, so the window is the
 * scroll element); smaller Sections render every item as before.
 *
 * Rows stay in normal flow between two spacers (no absolute positioning),
 * so the grid classes, focus order and `role="table"` rows keep working.
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";

/** Sections with more items than this are virtualised. */
export const VIRTUALIZE_ABOVE = 200;

/** File grid columns, the same breakpoints as `.gridFiles` (2 / 3 / 4 / 6). */
const COLUMN_QUERIES: [string, number][] = [
  ["(min-width: 1280px)", 6],
  ["(min-width: 900px)", 4],
  ["(min-width: 600px)", 3],
];

function columnsNow(): number {
  if (typeof window === "undefined") return 6;
  for (const [q, n] of COLUMN_QUERIES) if (window.matchMedia(q).matches) return n;
  return 2;
}

function subscribeColumns(onChange: () => void) {
  const lists = COLUMN_QUERIES.map(([q]) => window.matchMedia(q));
  lists.forEach((l) => l.addEventListener("change", onChange));
  return () => lists.forEach((l) => l.removeEventListener("change", onChange));
}

/** Columns of the file grid at the current viewport width. */
export function useGridColumns(): number {
  return useSyncExternalStore(subscribeColumns, columnsNow, () => 6);
}

/** True while `query` matches (false on the server). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Rows `[0, count)` virtualised against the window. `containerRef` goes on
 * the element that holds the rows (its offset from the top of the page is
 * the scroll margin). Answers the rows to render and the two spacer heights.
 */
export function useWindowRows({
  count,
  estimateSize,
  enabled,
  overscan = 4,
  gap = 0,
}: {
  count: number;
  estimateSize: number;
  enabled: boolean;
  overscan?: number;
  /** Space between rows that is not part of a row's measured box (a CSS margin). */
  gap?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    const update = () => {
      const el = containerRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setScrollMargin((prev) => (Math.abs(prev - top) > 0.5 ? top : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current?.parentElement) ro.observe(containerRef.current.parentElement);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled]);

  const virtualizer = useWindowVirtualizer({
    count: enabled ? count : 0,
    estimateSize: () => estimateSize,
    overscan,
    scrollMargin,
    gap,
  });

  const items = enabled ? virtualizer.getVirtualItems() : [];
  const total = enabled ? virtualizer.getTotalSize() : 0;
  const paddingTop = items.length ? items[0].start - scrollMargin : 0;
  const paddingBottom = items.length ? Math.max(0, total - (items[items.length - 1].end - scrollMargin)) : 0;

  return { containerRef, items, paddingTop, paddingBottom, measureElement: virtualizer.measureElement };
}
