// Story 3.5: the words of the password-reset email, in the recipient's
// locale. Pure (no JSON, no aliases) so `node --test` can load it with its
// own translator. The template renders these strings; it holds no copy.

import { formatTime } from '../lib/format.ts';
import { resolveLocale, resolveServerTimeZone } from '../i18n/config.ts';

/** A translator bound to the `email.passwordReset` messages of one locale. */
export type EmailTranslate = (key: string, values?: Record<string, string | number>) => string;

export type PasswordResetCopyInput = {
  /** Translator for a resolved locale (`translatorFor`), full key paths. */
  translatorFor: (locale: string) => EmailTranslate;
  /** Recipient's `users.locale`; null or unsupported falls back to DEFAULT_LOCALE, then English. */
  locale: string | null | undefined;
  /** IANA zone for the expiry time; missing means DEFAULT_TIMEZONE, invalid means UTC. */
  timeZone?: string | null;
  name: string;
  email: string;
  expiresAt: Date;
  validMinutes: number;
  productName: string;
};

export type PasswordResetCopy = {
  lang: string;
  subject: string;
  preview: string;
  heading: string;
  greeting: string;
  intro: string;
  validity: string;
  button: string;
  googleOnly: string;
  ignore: string;
  footer: string;
};

export function passwordResetCopy(input: PasswordResetCopyInput): PasswordResetCopy {
  const { productName, validMinutes } = input;
  const locale = resolveLocale(input.locale, process.env.DEFAULT_LOCALE);
  const t = input.translatorFor(locale);
  const k = (key: string, values?: Record<string, string | number>) =>
    t(`email.passwordReset.${key}`, { productName, ...(values ?? {}) });
  const until = formatTime(input.expiresAt, { locale, timeZone: resolveServerTimeZone(input.timeZone ?? process.env.DEFAULT_TIMEZONE) });
  const name = input.name?.trim();
  return {
    lang: locale,
    subject: k('subject'),
    preview: k('preview', { minutes: validMinutes }),
    heading: k('heading'),
    greeting: name ? k('greeting', { name }) : k('greetingAnon'),
    intro: k('intro', { email: input.email }),
    validity: k('validity', { minutes: validMinutes, time: until }),
    button: k('button'),
    googleOnly: k('googleOnly'),
    ignore: k('ignore'),
    footer: k('footer'),
  };
}
