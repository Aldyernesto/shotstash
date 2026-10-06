// Public surface of the demo module (Story 8.2): seed and reset of a public
// demo instance, the try-it session and the nightly schedule.
export { DEMO_SHARE_SLUG, DemoError, PROXY_KIND, createDemoSession, findDemoViewer, publishedDemoAccounts, resetDemo, seedDemo } from './service.ts';
export type { DemoRefusal, SeedResult } from './service.ts';
export { DEMO_LOCK, DEMO_LOCK_TTL_MS, DEMO_RESET_HOUR, demoMarkerKey, demoResetDate, localClock, nightlyDemoTick } from './schedule.ts';
export type { MarkerStore, NightlyOutcome } from './schedule.ts';
export { landscapeSvg, textPdf } from './media.ts';
