/**
 * Locale configuration shared by the server (request config, module code)
 * and the client (cookie sync, language select). Pure: no imports, so
 * `node --test` can load it directly.
 *
 * Resolution order: the signed-in user's `users.locale` (the client copies
 * it into the `shotstash_locale` cookie), then the cookie (read by server
 * components), then the instance `DEFAULT_LOCALE` env, then English.
 */

/** Locales that ship a `messages/<locale>.json` file. */
export const SUPPORTED_LOCALES = ['en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Last resort when nothing else resolves. English is the source locale. */
export const FALLBACK_LOCALE: Locale = 'en';

/** Cookie the client sets once the user is known; server components read it. */
export const LOCALE_COOKIE = 'shotstash_locale';

/** Display names for the language select, in the language itself. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
};

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The first supported candidate, else English. Candidates are tried in
 * order, so pass them highest priority first; unknown values (`fr`, `xx`,
 * empty, null) are skipped. Matching ignores case; the result is the
 * canonical tag from SUPPORTED_LOCALES.
 */
export function resolveLocale(...candidates: Array<string | null | undefined>): Locale {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    // Language tags are case-insensitive (BCP 47): "PT-br" finds "pt-BR" and
    // resolves to the canonical spelling listed in SUPPORTED_LOCALES.
    const wanted = candidate.trim().toLowerCase();
    const hit = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === wanted);
    if (hit) return hit;
  }
  return FALLBACK_LOCALE;
}

/** True when `timeZone` is an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Time zone for server-rendered text (emails, notifications): the
 * `DEFAULT_TIMEZONE` env when valid, else UTC. The browser shows times in
 * the viewer's own zone instead.
 */
export function resolveServerTimeZone(value?: string | null): string {
  return isValidTimeZone(value) ? value : 'UTC';
}
