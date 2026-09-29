/**
 * Server logging (Story 6.1): one JSON line per event on stdout via pino,
 * level from `LOG_LEVEL`. No transport, no telemetry.
 *
 *   const log = logger('trash-sweeper');
 *   log.info('purged', { files: 3 });
 *   log.error('failed', { err });          // an Error under `err` is serialized
 *
 * The root logger is created on first use, so importing this module never
 * reads configuration. Server code only; client components keep `console`.
 */
import pino, { type DestinationStream, type Logger } from 'pino';
import { config } from './config.ts';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
export type LogFields = Record<string, unknown>;
export type Log = Record<LogLevel, (msg: string, fields?: LogFields) => void>;

const LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

/** A pino logger writing JSON lines (ISO time, level as a label) to `destination` (stdout by default). */
export function createLogger(opts: { level?: string; destination?: DestinationStream } = {}): Logger {
  return pino(
    {
      level: opts.level ?? 'info',
      base: { app: 'shotstash' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: pino.stdSerializers.err },
    },
    opts.destination,
  );
}

let root: Logger | null = null;

function rootLogger(): Logger {
  if (!root) {
    let level = 'info';
    try {
      level = config().LOG_LEVEL;
    } catch {
      // Only during `next build`, where configuration is not read.
    }
    root = createLogger({ level });
  }
  return root;
}

/** Tests only: route every logger to `destination` (null restores stdout on next use). */
export function setLogDestination(destination: DestinationStream | null, level = 'info'): void {
  root = destination ? createLogger({ level, destination }) : null;
}

/** A logger whose lines carry `scope`. Cheap: nothing is created until the first line. */
export function logger(scope: string): Log {
  const out = {} as Log;
  for (const level of LEVELS) {
    out[level] = (msg, fields) => {
      const f: LogFields = { ...fields };
      // Anything thrown lands under `err`, so pino's error serializer applies.
      if ('err' in f && !(f.err instanceof Error) && f.err !== undefined) f.err = { message: String(f.err) };
      rootLogger()[level]({ scope, ...f }, msg);
    };
  }
  return out;
}

/** Message of anything thrown, for log fields. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
