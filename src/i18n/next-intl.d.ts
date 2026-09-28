// Story 3.1: typed message keys. `t('missing.key')` is a type error; English
// (messages/en.json) is the source every other locale file mirrors.
import type en from '../../messages/en.json';
import type { Locale } from './config';

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
