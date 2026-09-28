/**
 * Translator for module code (emails, notifications, background jobs):
 * never request-scoped, the locale is always explicit. Kept free of JSON
 * imports so `node --test` can load it with its own messages.
 */
import { createTranslator } from 'next-intl';

export type MessageTree = { [key: string]: string | MessageTree };

/**
 * A translator over `messagesByLocale[locale]`, falling back to the
 * `fallback` locale's messages when the locale has no file.
 */
export function makeTranslator(
  messagesByLocale: Record<string, MessageTree>,
  locale: string,
  fallback = 'en',
) {
  const resolved = messagesByLocale[locale] ? locale : fallback;
  type AppLocale = Parameters<typeof createTranslator>[0]['locale'];
  return createTranslator({ locale: resolved as AppLocale, messages: messagesByLocale[resolved] });
}
