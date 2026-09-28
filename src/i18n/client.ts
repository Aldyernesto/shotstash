'use client';
/**
 * Client side of locale resolution: once the user is known, their
 * `users.locale` is copied into the `shotstash_locale` cookie so server
 * components (root layout, `<html lang>`) render in the same locale.
 */
import { LOCALE_COOKIE, isSupportedLocale } from './config';

const ONE_YEAR = 60 * 60 * 24 * 365;

function readLocaleCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${LOCALE_COOKIE}=`));
  if (!hit) return null;
  try {
    return decodeURIComponent(hit.slice(LOCALE_COOKIE.length + 1));
  } catch {
    // Malformed value: treat it as unset so the next sync overwrites it.
    return null;
  }
}

/**
 * Sets the cookie to the user's locale, or clears it when the user has no
 * (supported) choice so the instance default applies. Returns true when
 * the cookie changed, meaning server-rendered text should refresh.
 */
export function syncLocaleCookie(userLocale: string | null | undefined): boolean {
  if (typeof document === 'undefined') return false;
  const current = readLocaleCookie();
  const next = isSupportedLocale(userLocale) ? userLocale : null;
  if (current === next) return false;
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = next
    ? `${LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}`
    : `${LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
  return true;
}
