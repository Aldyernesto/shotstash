/**
 * Story 3.4: the pure parts of the share page (`/s/<slug>`), kept free of
 * Prisma so `node --test` can load them: the visitor's locale and the
 * server-side sort orders. Sorting compares names in that locale.
 */

import { resolveLocale } from "../i18n/config.ts";
import type { ShareFileKind, ShareSection, ShareSort } from "./shareTypes.ts";
import { config } from "./config.ts";

/**
 * Locale of an anonymous share visitor: the `shotstash_locale` cookie when
 * it names a supported locale, then the instance `SHOTSTASH_DEFAULT_LOCALE`, then
 * English.
 */
export function shareLocale(
  cookieValue: string | null | undefined,
  instanceDefault: string | null | undefined = config().SHOTSTASH_DEFAULT_LOCALE,
): string {
  return resolveLocale(cookieValue, instanceDefault);
}

export function fileKindOf(mimeType?: string | null): ShareFileKind {
  const m = String(mimeType || "");
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

const KIND_ORDER: Record<ShareFileKind, number> = { video: 0, image: 1, audio: 2, document: 3 };

/** Name comparison in the visitor's locale. */
export function compareNames(locale: string): (a: string, b: string) => number {
  const collator = new Intl.Collator(locale);
  return (a, b) => collator.compare(a, b);
}

export function sortFiles<T extends { originalName: string; mimeType: string; size: bigint | number; createdAt: Date }>(
  rows: T[],
  sort: ShareSort,
  locale: string,
): T[] {
  const byName = compareNames(locale);
  const out = [...rows];
  if (sort === "name") out.sort((a, b) => byName(a.originalName, b.originalName));
  else if (sort === "size") out.sort((a, b) => Number(b.size) - Number(a.size));
  else if (sort === "type")
    out.sort(
      (a, b) =>
        KIND_ORDER[fileKindOf(a.mimeType)] - KIND_ORDER[fileKindOf(b.mimeType)] ||
        byName(a.originalName, b.originalName),
    );
  else out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // newest first
  return out;
}

export function sortSections<T extends Pick<ShareSection, "number" | "title" | "fileCount">>(
  rows: T[],
  sort: ShareSort,
  locale: string,
): T[] {
  const byName = compareNames(locale);
  const out = [...rows];
  if (sort === "name") out.sort((a, b) => byName(a.title, b.title));
  else if (sort === "count") out.sort((a, b) => b.fileCount - a.fileCount);
  else
    out.sort((a, b) => {
      // Number ascending; names without a number always go last.
      const na = a.number === null ? Infinity : Number(a.number.split(".")[0]);
      const nb = b.number === null ? Infinity : Number(b.number.split(".")[0]);
      return na - nb || byName(a.title, b.title);
    });
  return out;
}
