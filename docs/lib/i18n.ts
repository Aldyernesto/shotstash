import { defineI18n } from 'fumadocs-core/i18n';

/**
 * English only in v1. A second locale is added by listing it here and adding
 * `page.<locale>.mdx` files next to the English ones (the default `dot`
 * parser); the default locale keeps its unprefixed URLs.
 */
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en'],
  hideLocale: 'default-locale',
});
