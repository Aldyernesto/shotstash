"use client";

/**
 * Story 4.5: the file grid of a Section. Up to `VIRTUALIZE_ABOVE` files it
 * renders every card in one grid, exactly as before; above that it packs
 * the cards into rows of N columns (the grid's own breakpoints) and renders
 * only the rows near the viewport, so a 10,000-file Section stays fast.
 */
import React from "react";
import { VIRTUALIZE_ABOVE, useGridColumns, useWindowRows } from "./virtualRows";

/** A card plus its caption, with the row gap (for the first estimate only; rows are measured). */
const ROW_ESTIMATE_PX = 300;

export default function FileGrid<T extends { id: string }>({
  files,
  className,
  rowClassName,
  renderCard,
}: {
  files: T[];
  /** The `.gridFiles` class: columns and gaps. */
  className: string;
  /** Added to each virtual row: the vertical gap between rows (as `padding-bottom`, so it is measured). */
  rowClassName?: string;
  renderCard: (file: T, index: number) => React.ReactNode;
}) {
  const virtual = files.length > VIRTUALIZE_ABOVE;
  const columns = useGridColumns();
  const rowCount = virtual ? Math.ceil(files.length / columns) : 0;
  const { containerRef, items, paddingTop, paddingBottom, measureElement } = useWindowRows({
    count: rowCount,
    estimateSize: ROW_ESTIMATE_PX,
    enabled: virtual,
  });

  if (!virtual) {
    return <div className={className}>{files.map((f, i) => renderCard(f, i))}</div>;
  }

  return (
    <div ref={containerRef} data-virtual-grid="" data-total={files.length}>
      <div style={{ height: paddingTop }} aria-hidden="true" />
      {items.map((row) => {
        const start = row.index * columns;
        const slice = files.slice(start, start + columns);
        return (
          <div
            key={row.key}
            ref={measureElement}
            data-index={row.index}
            className={`${className} ${rowClassName ?? ""}`}
          >
            {slice.map((f, i) => renderCard(f, start + i))}
          </div>
        );
      })}
      <div style={{ height: paddingBottom }} aria-hidden="true" />
    </div>
  );
}
