import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale, resolveServerTimeZone } from './config';
import { config } from '@/lib/config';

/**
 * next-intl request config without locale routing: no URL prefix, the
 * locale comes from the `shotstash_locale` cookie (set by the client from
 * `users.locale`), then `SHOTSTASH_DEFAULT_LOCALE`, then English.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value, config().SHOTSTASH_DEFAULT_LOCALE);
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: resolveServerTimeZone(config().SHOTSTASH_DEFAULT_TIMEZONE),
  };
});
