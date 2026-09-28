// Public surface of the i18n module (Story 3.1).
import en from '../../../messages/en.json';
import { resolveLocale, SUPPORTED_LOCALES } from '@/i18n/config';
import { makeTranslator, type MessageTree } from './translator';

export {
  FALLBACK_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  resolveLocale,
  resolveServerTimeZone,
} from '@/i18n/config';
export type { Locale } from '@/i18n/config';

export const supportedLocales = SUPPORTED_LOCALES;

const MESSAGES: Record<string, MessageTree> = { en };

/**
 * Translator for module code with an explicit locale (a recipient's
 * `users.locale`, or null for the instance default). Unknown locales fall
 * back to `DEFAULT_LOCALE`, then English.
 */
export function translatorFor(locale?: string | null) {
  return makeTranslator(MESSAGES, resolveLocale(locale, process.env.DEFAULT_LOCALE));
}
