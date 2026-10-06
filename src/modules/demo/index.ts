// Public surface of the demo module (Story 8.2): seed and reset of a public
// demo instance, the try-it session and the nightly schedule.
export { DemoError, PROXY_KIND, createDemoSession, resetDemo, seedDemo } from './service.ts';
export type { SeedResult } from './service.ts';
export { DEMO_RESET_HOUR, demoResetDue, localClock } from './schedule.ts';
export { landscapeSvg, textPdf } from './media.ts';
