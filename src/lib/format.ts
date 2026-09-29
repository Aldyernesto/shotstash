// Stories 1.9 / 3.1: one place for number, size, date and time formatting.
// Every helper takes the active locale (default English) and, for times,
// an optional IANA time zone. In the browser the zone defaults to the
// viewer's own; server-rendered text passes SHOTSTASH_DEFAULT_TIMEZONE (UTC by
// default). Absolute times always carry a short zone label ("17:00 GMT+7").
// Camera time (EXIF) has its own path and is never converted.
// Words (relative time, orientation, "camera time") come from the caller's
// messages: src/lib cannot import the i18n layer, so callers pass labels.

import { resolveServerTimeZone } from "../i18n/config.ts";

export type FormatOptions = {
  /** BCP 47 locale, default "en". */
  locale?: string;
  /** IANA time zone; default is the runtime's own zone. */
  timeZone?: string;
};

type DateLike = Date | string | number;

const DEFAULT_LOCALE = "en";

function toDate(d: DateLike): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Integers and decimals grouped by locale: 7354 -> "7,354". */
export function formatNumber(n: number, opts: FormatOptions = {}): string {
  return new Intl.NumberFormat(opts.locale ?? DEFAULT_LOCALE).format(n);
}

/** File size with one decimal from KB up: 1536 -> "1.5 KB", 2.5 GiB -> "2.5 GB". */
export function formatFileSize(bytes: number, opts: FormatOptions = {}): string {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  let v = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const digits = u === 0 ? 0 : 1;
  const s = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
  return `${s} ${units[u]}`;
}

/**
 * Short date: "28 Sep 2026". English is written day-first with the
 * abbreviated month (the design's date style); other locales use their own
 * CLDR order.
 */
export function formatDate(d: DateLike, opts: FormatOptions = {}): string {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return "";
  const fmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: opts.timeZone,
  });
  if (!locale.toLowerCase().startsWith("en")) return fmt.format(date);
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}`;
}

/**
 * Short date for server-rendered text: the instance zone (the caller passes
 * `config().SHOTSTASH_DEFAULT_TIMEZONE`; UTC when unset or invalid), never the
 * server machine's own zone. This file is shared with client code, so it
 * never reads configuration itself.
 */
export function formatServerDate(d: DateLike, timeZoneSetting: string | null | undefined): string {
  return formatDate(d, { timeZone: resolveServerTimeZone(timeZoneSetting) });
}

/** 24-hour time with a short zone label: "17:00 GMT+7", "10:00 UTC". */
export function formatTime(d: DateLike, opts: FormatOptions = {}): string {
  const date = toDate(d);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(opts.locale ?? DEFAULT_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: opts.timeZone,
    timeZoneName: "short",
  }).format(date);
}

/** Date and time: "28 Sep 2026 · 17:00 GMT+7". */
export function formatDateTime(d: DateLike, opts: FormatOptions = {}): string {
  const date = formatDate(d, opts);
  return date ? `${date} · ${formatTime(d, opts)}` : "";
}

/** Labels for relative time, usually from the `format` message namespace. */
export type RelativeLabels = {
  justNow: string;
  minutesAgo: (count: number) => string;
  hoursAgo: (count: number) => string;
};

const ENGLISH_RELATIVE: RelativeLabels = {
  justNow: "just now",
  minutesAgo: (n) => `${formatNumber(n)} min ago`,
  hoursAgo: (n) => `${formatNumber(n)} h ago`,
};

/**
 * Relative time: "just now" / "5 min ago" / "3 h ago", then the short date
 * ("16 Sep 2026") from one day on.
 */
export function formatRelative(
  d: DateLike,
  opts: FormatOptions & { now?: Date; labels?: RelativeLabels } = {},
): string {
  const labels = opts.labels ?? ENGLISH_RELATIVE;
  const now = opts.now ?? new Date();
  const diff = Math.floor((now.getTime() - toDate(d).getTime()) / 1000);
  if (diff < 60) return labels.justNow;
  if (diff < 3600) return labels.minutesAgo(Math.floor(diff / 60));
  if (diff < 86400) return labels.hoursAgo(Math.floor(diff / 3600));
  return formatDate(d, opts);
}

/**
 * Camera time (EXIF): written as is, never converted, plus a label such as
 * "(camera time)" so the reader knows it is not their zone. Never pass a
 * Date here: a Date has already lost the camera's wall clock.
 */
export function formatExifCameraTime(raw: string, label: string): string {
  return `${raw} ${label}`;
}

/** Video clock "MM:SS": 138 -> "02:18". Minutes may pass 59 ("75:00"). */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* Common ratios snapped within 2 %. Anything else only gets the
   orientation word: an odd ratio (1440:1081) helps nobody. */
const COMMON_RATIOS: [number, number][] = [
  [1, 1], [16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3], [4, 5], [5, 4], [21, 9],
];

/** Orientation code; the visible word comes from messages. */
export type Orientation = "portrait" | "landscape" | "square";

export type AspectInfo = {
  orientation: Orientation;
  /** "9:16" when it matches a common ratio, else null. */
  ratio: string | null;
};

/** Orientation and common ratio from width x height AFTER rotation. */
export function describeAspect(width: number, height: number): AspectInfo | null {
  if (!(width > 0) || !(height > 0)) return null;
  const r = width / height;
  let ratio: string | null = null;
  let snapped = r;
  for (const [a, b] of COMMON_RATIOS) {
    if (Math.abs(r - a / b) / (a / b) < 0.02) {
      ratio = `${a}:${b}`;
      snapped = a / b;
      break;
    }
  }
  // Derived from the snapped ratio so "Portrait (1:1)" can never appear.
  const orientation: Orientation =
    Math.abs(snapped - 1) < 0.01 ? "square" : snapped < 1 ? "portrait" : "landscape";
  return { orientation, ratio };
}

/** Info panel dimensions: 2160, 3840 -> "2160 × 3840 px · Portrait (9:16)".
    Pixels are written plain (no grouping): a size, not a count. */
export function formatDimensions(
  width: number,
  height: number,
  orientationLabel: (o: Orientation) => string,
): string {
  const info = describeAspect(width, height);
  const base = `${Math.round(width)} × ${Math.round(height)} px`;
  if (!info) return base;
  const word = orientationLabel(info.orientation);
  return info.ratio ? `${base} · ${word} (${info.ratio})` : `${base} · ${word}`;
}
