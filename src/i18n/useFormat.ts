'use client';
/**
 * Locale-bound formatting for client components: the pure helpers from
 * `@/lib/format` plus the words they need from the `format`, `content` and
 * `roles` message namespaces. Times use the viewer's browser time zone.
 */
import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  formatDate,
  formatDateTime,
  formatDimensions,
  formatExifCameraTime,
  formatFileSize,
  formatNumber,
  formatRelative,
  formatTime,
} from '@/lib/format';
import { contentSummaryParts, type ContentSummary } from '@/lib/contentSummary';
import { roleKey, type RoleLike } from '@/lib/permissions';

type DateLike = Date | string | number;

export function useFormat() {
  const locale = useLocale();
  const tf = useTranslations('format');
  const tc = useTranslations('content');
  const tr = useTranslations('roles');

  return useMemo(() => {
    const opts = { locale };
    const contentParts = (summary?: ContentSummary | null, largestFirst = false) =>
      contentSummaryParts(summary, largestFirst).map((p) => tc(p.kind, { count: p.count }));
    return {
      locale,
      number: (n: number) => formatNumber(n, opts),
      fileSize: (bytes: number) => formatFileSize(bytes, opts),
      date: (d: DateLike) => formatDate(d, opts),
      time: (d: DateLike) => formatTime(d, opts),
      dateTime: (d: DateLike) => formatDateTime(d, opts),
      relative: (d: DateLike, now?: Date) =>
        formatRelative(d, {
          ...opts,
          now,
          labels: {
            justNow: tf('justNow'),
            minutesAgo: (count) => tf('minutesAgo', { count }),
            hoursAgo: (count) => tf('hoursAgo', { count }),
          },
        }),
      cameraTime: (raw: string) => formatExifCameraTime(raw, tf('cameraTime')),
      dimensions: (w: number, h: number) => formatDimensions(w, h, (o) => tf(`orientation.${o}`)),
      /** "3 photos", "1 video", ... in fixed or largest-first order. */
      contentParts,
      /** "Contains 1,900 videos · 650 photos"; "" when empty. */
      contentSentence: (summary?: ContentSummary | null) => {
        const parts = contentParts(summary, true);
        return parts.length ? tc('summary', { parts: parts.join(' · ') }) : '';
      },
      /** Role word from messages ("super admin"); "unknown role" when missing or unknown. */
      role: (subject: RoleLike) => {
        const key = roleKey(subject);
        return tr(key ?? 'unknown');
      },
    };
  }, [locale, tf, tc, tr]);
}
