/**
 * Story 8.2: when the nightly demo reset is due. The server checks every
 * minute; the reset runs once per local date, at or after 03:00 in the
 * instance time zone (`SHOTSTASH_DEFAULT_TIMEZONE`), within the first hour
 * (a server that was down at 03:00 skips that night rather than resetting
 * in the middle of the day). Pure and alias-free.
 */

export const DEMO_RESET_HOUR = 3;

/** Local date (YYYY-MM-DD) and hour of `now` in `timeZone`. */
export function localClock(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** The local date to reset for, or null when no reset is due (`lastDate`: the date of the last reset). */
export function demoResetDue(now: Date, timeZone: string, lastDate: string | null): string | null {
  const { date, hour } = localClock(now, timeZone);
  if (hour !== DEMO_RESET_HOUR) return null;
  return date === lastDate ? null : date;
}
