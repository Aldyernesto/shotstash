/**
 * Runtime configuration (Story 6.3): the only reader of `process.env` in
 * `src/` and `server.ts` (lint rule `local/no-process-env`; the one allowed
 * exception elsewhere is `process.env.NODE_ENV`, a build-time constant).
 *
 * One variable table drives everything: the parser below, the generated
 * `.env.example` and `docs/configuration.md` (`npm run env:example`), the
 * public `GET /api/v1/config` and `me.features`.
 *
 * Validation is shape-only (types, lengths, known values); reachability of
 * the database, cache and storage is checked by setup and `/api/health`.
 * `config()` is lazy and memoized and never throws on a bad value: a bad
 * variable falls back to its default and is recorded as a problem.
 * `assertConfig()` runs once at server boot and fails with every problem
 * listed by variable name, so a running server always has a clean config.
 *
 * Pure apart from reading `process.env` and `package.json`, and free of
 * path aliases so `node --test` and `scripts/gen-env-example.mjs` can load it.
 * Never import it from client components.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isValidTimeZone, resolveLocale } from '../i18n/config.ts';
import { brand } from './brand.ts';
import { HEARTBEAT_SECONDS } from './pipelineContract.ts';

/* ------------------------------------------------------------------ */
/* Variable table                                                      */
/* ------------------------------------------------------------------ */

/**
 * `infra` variables (infrastructure and secrets) keep plain names, `product`
 * settings take the `SHOTSTASH_` prefix, `compose` variables are read by
 * docker-compose.yml only (never by the app).
 */
export type VarKind = 'infra' | 'product' | 'compose';

export const GROUPS = [
  'Server',
  'Database',
  'Secrets',
  'Storage',
  'Cache',
  'Search',
  'Sign-in',
  'Email',
  'Product',
  'Pipeline',
  'Demo',
  'Docker Compose',
] as const;

export type VarGroup = (typeof GROUPS)[number];

export type VarDef<T = unknown, Always extends boolean = boolean> = {
  group: VarGroup;
  kind: VarKind;
  /** Validates a present, non-empty value. */
  schema: z.ZodType<T>;
  /** Used when the variable is unset or empty. */
  default?: T;
  /** Unset is a problem (listed at boot). */
  required?: boolean;
  /** Never shown with a value: `.env.example` leaves it empty. */
  secret?: boolean;
  /** A secret the operator generates (`.env.example` shows the command). Default true for secrets. */
  generate?: boolean;
  /** Set by the Docker image: `.env.example` shows it commented out so an empty line never overrides the image. */
  managed?: boolean;
  /** Value written to `.env.example` (never a real secret). */
  example?: string;
  /** Shown as the comment above the variable. */
  description: string;
  /** Marker for the type mapping below: true when a value is always present. */
  readonly always?: Always;
};

export const SECRET_PLACEHOLDER = 'change-me-before-first-run';
export const MIN_SECRET_LENGTH = 32;
export const SECRET_HINT = 'openssl rand -hex 32';
/** Shortest pipeline sweep interval allowed with NODE_ENV=production (seconds). */
export const PIPELINE_SWEEP_MIN_PRODUCTION = 5;

const text = z.string().trim().min(1);
const url = z
  .string()
  .trim()
  .pipe(z.url('must be a URL such as http://host:port'))
  .refine((v) => /^https?:\/\//i.test(v), 'must start with http:// or https://')
  .refine((v) => !v.includes('?') && !v.includes('#'), 'must not contain a query (?) or a fragment (#)');
const port = z.coerce.number({ error: 'must be a number' }).int('must be a whole number').min(1, 'must be 1 to 65535').max(65535, 'must be 1 to 65535');
const bool = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => ['true', 'false', '1', '0', 'yes', 'no'].includes(v), 'must be true or false')
  .transform((v) => v === 'true' || v === '1' || v === 'yes');
const secret = z
  .string()
  .trim()
  .refine((v) => v !== SECRET_PLACEHOLDER, `still holds the example placeholder (generate one with: ${SECRET_HINT})`)
  .refine((v) => v.length >= MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters (generate one with: ${SECRET_HINT})`);

function opt<T>(d: Omit<VarDef<T>, 'default' | 'required' | 'always'>): VarDef<T, false> {
  return d as VarDef<T, false>;
}
function withDefault<T>(d: Omit<VarDef<T>, 'required' | 'always'> & { default: T }): VarDef<T, true> {
  return d as VarDef<T, true>;
}
function req<T>(d: Omit<VarDef<T>, 'default' | 'required' | 'always'>): VarDef<T, true> {
  return { ...d, required: true } as VarDef<T, true>;
}

export const VARIABLES = {
  /* ---------- Server ---------- */
  NODE_ENV: opt({
    group: 'Server',
    kind: 'infra',
    schema: z.enum(['development', 'production', 'test']),
    managed: true,
    description: 'development, production or test. The Docker image sets production; leave unset for local development.',
  }),
  PORT: withDefault({
    group: 'Server',
    kind: 'infra',
    schema: port,
    default: 3005,
    example: '3005',
    description: 'Port the server listens on inside the machine or container.',
  }),
  APP_URL: opt({
    group: 'Server',
    kind: 'infra',
    schema: url,
    description:
      'Public URL of this installation (the address people open: LAN IP or domain), used in emails and share links. ' +
      'Defaults to http://localhost:<PORT> (with docker compose: http://localhost:<SHOTSTASH_PORT>). ' +
      '/api/health reports schemeMismatch when this says https but requests arrive as http.',
  }),
  TRUST_PROXY: withDefault({
    group: 'Server',
    kind: 'infra',
    schema: bool,
    default: false,
    description:
      'Set to true ONLY when the app is reachable exclusively through a reverse proxy (Cloudflare, nginx) that sets ' +
      'cf-connecting-ip, x-forwarded-for and x-forwarded-proto. Otherwise clients could spoof those headers.',
  }),
  LOG_LEVEL: withDefault({
    group: 'Server',
    kind: 'infra',
    schema: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
    default: 'info' as 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent',
    example: 'info',
    description: 'fatal, error, warn, info, debug, trace or silent. Logs are JSON lines on stdout.',
  }),

  /* ---------- Database ---------- */
  DATABASE_URL: req({
    group: 'Database',
    kind: 'infra',
    schema: z
      .string()
      .trim()
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must start with postgresql://'),
    example: 'postgresql://postgres:postgres@127.0.0.1:55433/postgres?sslmode=disable',
    description:
      'PostgreSQL connection string. Local development: `npm run dev:db` starts an embedded PGlite server on port 55433. ' +
      'docker compose sets this for the app container itself.',
  }),

  /* ---------- Secrets ---------- */
  SESSION_SECRET: req({
    group: 'Secrets',
    kind: 'infra',
    secret: true,
    schema: secret,
    description: 'Signs sessions and password reset codes. At least 32 characters.',
  }),
  MEDIA_SIGNING_SECRET: opt({
    group: 'Secrets',
    kind: 'infra',
    secret: true,
    schema: secret,
    description: 'Signs share media URLs, share access cookies and access codes. Falls back to SESSION_SECRET when empty.',
  }),
  SETUP_TOKEN: opt({
    group: 'Secrets',
    kind: 'infra',
    secret: true,
    schema: text,
    description:
      'Recommended on any reachable host. While first-run setup is open, whoever submits /setup first becomes the super admin; ' +
      'with SETUP_TOKEN set the form requires it.',
  }),

  /* ---------- Storage ---------- */
  STORAGE_BACKEND: withDefault({
    group: 'Storage',
    kind: 'infra',
    schema: z.enum(['local', 's3']),
    default: 'local' as 'local' | 's3',
    example: 'local',
    description:
      'local (a directory, STORAGE_LOCAL_ROOT) or s3 (any S3-compatible bucket: AWS S3, Cloudflare R2, MinIO, RustFS, SeaweedFS). ' +
      'One backend per installation; switching later is a copy procedure (docs/storage.md).',
  }),
  STORAGE_LOCAL_ROOT: withDefault({
    group: 'Storage',
    kind: 'infra',
    schema: text,
    default: './data/media',
    example: './data/media',
    description:
      'local backend: directory for originals, thumbnails, covers and upload parts (any path, including a NAS mount). ' +
      'The Docker image uses /data/media.',
  }),
  S3_ENDPOINT: opt({
    group: 'Storage',
    kind: 'infra',
    schema: url,
    description: 's3 backend: endpoint URL, such as https://<account>.r2.cloudflarestorage.com or http://minio:9000. Empty for AWS S3.',
  }),
  S3_REGION: withDefault({
    group: 'Storage',
    kind: 'infra',
    schema: text,
    default: 'us-east-1',
    example: 'us-east-1',
    description: 's3 backend: region. R2 uses auto; MinIO and RustFS accept us-east-1.',
  }),
  S3_BUCKET: opt({
    group: 'Storage',
    kind: 'infra',
    schema: text,
    description: 's3 backend: bucket name (required with STORAGE_BACKEND=s3). Keep the bucket private.',
  }),
  S3_ACCESS_KEY_ID: opt({
    group: 'Storage',
    kind: 'infra',
    schema: text,
    description: 's3 backend: access key id (required with STORAGE_BACKEND=s3).',
  }),
  S3_SECRET_ACCESS_KEY: opt({
    group: 'Storage',
    kind: 'infra',
    secret: true,
    generate: false,
    schema: text,
    description: 's3 backend: secret access key (required with STORAGE_BACKEND=s3).',
  }),
  S3_FORCE_PATH_STYLE: withDefault({
    group: 'Storage',
    kind: 'infra',
    schema: bool,
    default: false,
    example: 'false',
    description: 's3 backend: true for servers that need path-style URLs (MinIO, RustFS, SeaweedFS); false for AWS S3 and R2.',
  }),

  /* ---------- Cache ---------- */
  DRAGONFLY_HOST: withDefault({
    group: 'Cache',
    kind: 'infra',
    schema: text,
    default: '127.0.0.1',
    example: '127.0.0.1',
    description: 'Dragonfly (or Redis) host for realtime events, rate limits and locks. docker compose sets this for the app container.',
  }),
  DRAGONFLY_PORT: withDefault({
    group: 'Cache',
    kind: 'infra',
    schema: port,
    default: 6379,
    example: '6379',
    description: 'Dragonfly port.',
  }),
  DRAGONFLY_PASSWORD: opt({
    group: 'Cache',
    kind: 'infra',
    secret: true,
    schema: text,
    description: 'Dragonfly password, when the server requires one. docker compose ignores it (the bundled cache is reachable only on the compose network).',
  }),

  /* ---------- Search ---------- */
  ELASTICSEARCH_NODE_URL: opt({
    group: 'Search',
    kind: 'infra',
    schema: url,
    description:
      'Optional. Elasticsearch accelerates search; leave empty to search in PostgreSQL only. ' +
      'With docker compose: `--profile search` and http://elasticsearch:9200.',
  }),

  /* ---------- Sign-in ---------- */
  SHOTSTASH_FEATURE_SIGNUP: withDefault({
    group: 'Sign-in',
    kind: 'product',
    schema: bool,
    default: true,
    example: 'true',
    description: 'Public sign-up (new accounts wait for admin approval). Set to false to allow only admin-created accounts.',
  }),
  GOOGLE_CLIENT_ID: opt({
    group: 'Sign-in',
    kind: 'infra',
    schema: text,
    description: 'Optional. Google sign-in OAuth client id; leave empty to hide the button. A restart applies it, no rebuild.',
  }),

  /* ---------- Email ---------- */
  EMAIL_TRANSPORT: opt({
    group: 'Email',
    kind: 'infra',
    schema: z.enum(['log', 'resend']),
    description:
      'Optional. Email for password reset. resend (or RESEND_API_KEY set): sent through Resend. ' +
      'log: nothing is sent, the last message is kept in memory (development and tests). Empty and no key: password reset stays hidden.',
  }),
  EMAIL_FROM: withDefault({
    group: 'Email',
    kind: 'infra',
    schema: text,
    default: `${brand.productName} <${brand.emailFrom}>`,
    example: '"Shotstash <no-reply@example.com>"',
    description: 'Sender address of outgoing email.',
  }),
  RESEND_API_KEY: opt({
    group: 'Email',
    kind: 'infra',
    secret: true,
    schema: text,
    generate: false,
    description: 'Resend API key.',
  }),

  /* ---------- Product ---------- */
  SHOTSTASH_DEFAULT_LOCALE: withDefault({
    group: 'Product',
    kind: 'product',
    schema: text,
    default: 'en',
    example: 'en',
    description: 'Language for visitors and new accounts until they pick one. Unknown values fall back to en.',
  }),
  SHOTSTASH_DEFAULT_TIMEZONE: withDefault({
    group: 'Product',
    kind: 'product',
    schema: z.string().trim().refine((v) => isValidTimeZone(v), 'must be an IANA time zone such as UTC or Asia/Jakarta'),
    default: 'UTC',
    example: 'UTC',
    description: 'Time zone for server-written text (emails, share pages). Browsers show times in the viewer\'s own zone.',
  }),
  SHOTSTASH_TRASH_RETENTION_DAYS: withDefault({
    group: 'Product',
    kind: 'product',
    schema: z.coerce
      .number({ error: 'must be a whole number of days' })
      .int('must be a whole number of days')
      .min(1, 'must be at least 1')
      .max(36500, 'must be at most 36500 (100 years)'),
    default: 30,
    example: '30',
    description: 'Days an item stays in the Trash before the hourly sweeper deletes it for good.',
  }),
  SHOTSTASH_FEATURE_DISCUSSION: withDefault({
    group: 'Product',
    kind: 'product',
    schema: bool,
    default: true,
    example: 'true',
    description:
      'Project discussion (chat and @mentions). Set to false to hide it: its API answers FEATURE_DISABLED and the UI hides it; no data is removed.',
  }),
  SHOTSTASH_VERSION: opt({
    group: 'Product',
    kind: 'product',
    schema: text,
    managed: true,
    description: 'Set by the Docker image. Leave unset; the version in package.json is used otherwise.',
  }),

  /* ---------- Pipeline ---------- */
  WORKER_BOOTSTRAP_TOKEN: opt({
    group: 'Pipeline',
    kind: 'infra',
    secret: true,
    schema: secret,
    description:
      'Shared token a processing worker presents once to register (POST /api/v1/pipeline/workers/register); each worker then ' +
      'gets its own token. docker compose requires it (the bundled reference worker uses it). Empty: no worker can register.',
  }),
  SHOTSTASH_PIPELINE_MAX_OUTPUT_MB: withDefault({
    group: 'Pipeline',
    kind: 'product',
    schema: z.coerce
      .number({ error: 'must be a whole number of megabytes' })
      .int('must be a whole number of megabytes')
      .min(1, 'must be at least 1')
      .max(1048576, 'must be at most 1048576 (1 TiB)'),
    default: 20480,
    example: '20480',
    description: 'Largest output a worker may upload for one job, in megabytes (MiB).',
  }),
  SHOTSTASH_PIPELINE_LEASE_SECONDS: withDefault({
    group: 'Pipeline',
    kind: 'product',
    schema: z.coerce
      .number({ error: 'must be a whole number of seconds' })
      .int('must be a whole number of seconds')
      .min(30, 'must be at least 30')
      .max(3600, 'must be at most 3600'),
    default: 90,
    example: '90',
    description:
      'A claimed job whose worker sent no heartbeat for this long goes back to the queue (it fails after 3 attempts). ' +
      'Workers heartbeat every 30 s; a worker seen within this time counts as live.',
  }),
  SHOTSTASH_PIPELINE_SWEEP_SECONDS: withDefault({
    group: 'Pipeline',
    kind: 'product',
    schema: z.coerce
      .number({ error: 'must be a whole number of seconds' })
      .int('must be a whole number of seconds')
      .min(1, 'must be at least 1')
      .max(3600, 'must be at most 3600'),
    default: 30,
    example: '30',
    description: `How often the job sweeper looks for expired claims. At least ${PIPELINE_SWEEP_MIN_PRODUCTION} in production; shorter values are for tests.`,
  }),

  /* ---------- Demo ---------- */
  SHOTSTASH_DEMO_MODE: withDefault({
    group: 'Demo',
    kind: 'product',
    schema: bool,
    default: false,
    description:
      'Demo instances only. With true, `npm run demo:seed` (after first-run setup) creates read-only demo accounts and a sample project.',
  }),
  DEMO_ADMIN_PASSWORD: opt({
    group: 'Demo',
    kind: 'infra',
    secret: true,
    schema: z.string().min(10, 'must be at least 10 characters'),
    generate: false,
    description: 'Demo instances only. Password of every demo account, at least 10 characters.',
  }),

  /* ---------- Docker Compose (read by docker-compose.yml, not by the app) ---------- */
  POSTGRES_PASSWORD: req({
    group: 'Docker Compose',
    kind: 'compose',
    secret: true,
    schema: z.string().regex(/^[A-Za-z0-9_-]+$/, 'use letters, digits, - and _ only'),
    description:
      'docker compose only: password of the bundled PostgreSQL, fixed when the database is first created ' +
      '(changing it later breaks the connection). Letters, digits, - and _ only.',
  }),
  SHOTSTASH_PORT: withDefault({
    group: 'Docker Compose',
    kind: 'compose',
    schema: port,
    default: 3005,
    example: '3005',
    description: 'docker compose only: host port published for the app. Change it when 3005 is taken.',
  }),
} satisfies Record<string, VarDef>;

export type VarName = keyof typeof VARIABLES;

type ValueOf<D> = D extends VarDef<infer T, infer A> ? (A extends true ? T : T | undefined) : never;

type AppVarName = { [K in VarName]: (typeof VARIABLES)[K]['kind'] extends 'compose' ? never : K }[VarName];

export type ConfigValues = { [K in AppVarName]: ValueOf<(typeof VARIABLES)[K]> };

export type Features = {
  /** Public sign-up (register mutation and Google auto sign-up). */
  signup: boolean;
  /** Google sign-in: a client id is set. */
  google: boolean;
  /** Elasticsearch search: a node URL is set. */
  search: boolean;
  /** Password reset by email: a transport that can send is set. */
  passwordResetEmail: boolean;
  /** Project discussion and mentions (SHOTSTASH_FEATURE_DISCUSSION). */
  discussion: boolean;
};

export type Config = ConfigValues & {
  features: Features;
  /** Public URL without a trailing slash. */
  appUrl: string;
  version: string;
  /** Supported default locale. */
  defaultLocale: string;
};

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

export type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Pure: parses `env` against the table. Never throws. */
export function loadConfig(env: Env): { config: Config; problems: string[] } {
  const problems: string[] = [];
  const values: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(VARIABLES) as Array<[VarName, VarDef]>) {
    if (def.kind === 'compose') continue;
    const raw = env[name];
    const present = typeof raw === 'string' && raw.trim() !== '';
    if (!present) {
      if (def.required) problems.push(`${name}: is not set`);
      values[name] = def.default;
      continue;
    }
    const parsed = def.schema.safeParse(raw);
    if (parsed.success) {
      values[name] = parsed.data;
    } else {
      const messages = [...new Set(parsed.error.issues.map((i) => i.message))];
      problems.push(`${name}: ${messages.join('; ')}`);
      values[name] = def.default;
    }
  }
  // Cross-field rules, after every variable parsed on its own.
  if (values.EMAIL_TRANSPORT === 'resend' && !values.RESEND_API_KEY) {
    problems.push('RESEND_API_KEY: required when EMAIL_TRANSPORT=resend');
  }
  if (values.NODE_ENV === 'production' && Number(values.SHOTSTASH_PIPELINE_SWEEP_SECONDS) < PIPELINE_SWEEP_MIN_PRODUCTION) {
    problems.push(`SHOTSTASH_PIPELINE_SWEEP_SECONDS: must be at least ${PIPELINE_SWEEP_MIN_PRODUCTION} in production`);
    values.SHOTSTASH_PIPELINE_SWEEP_SECONDS = VARIABLES.SHOTSTASH_PIPELINE_SWEEP_SECONDS.default;
  }
  // A lease must survive one lost heartbeat, and the sweeper must look at
  // least twice per lease.
  const lease = Number(values.SHOTSTASH_PIPELINE_LEASE_SECONDS);
  const sweep = Number(values.SHOTSTASH_PIPELINE_SWEEP_SECONDS);
  if (lease <= 2 * HEARTBEAT_SECONDS) {
    problems.push(
      `SHOTSTASH_PIPELINE_LEASE_SECONDS: must be more than twice the worker heartbeat interval (${HEARTBEAT_SECONDS} s), so more than ${2 * HEARTBEAT_SECONDS}`,
    );
  }
  if (sweep > lease / 2) {
    problems.push(
      `SHOTSTASH_PIPELINE_SWEEP_SECONDS: must be at most half of SHOTSTASH_PIPELINE_LEASE_SECONDS (${sweep} > ${lease} / 2)`,
    );
  }
  if (values.STORAGE_BACKEND === 's3') {
    for (const name of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!values[name]) problems.push(`${name}: required when STORAGE_BACKEND=s3`);
    }
  }
  const v = values as ConfigValues;
  const config: Config = {
    ...v,
    features: {
      signup: v.SHOTSTASH_FEATURE_SIGNUP,
      google: Boolean(v.GOOGLE_CLIENT_ID),
      search: Boolean(v.ELASTICSEARCH_NODE_URL),
      passwordResetEmail: v.EMAIL_TRANSPORT === 'log' || Boolean(v.RESEND_API_KEY),
      discussion: v.SHOTSTASH_FEATURE_DISCUSSION,
    },
    appUrl: (v.APP_URL || `http://localhost:${v.PORT}`).replace(/\/+$/, ''),
    version: v.SHOTSTASH_VERSION || readPackageVersion(),
    defaultLocale: resolveLocale(v.SHOTSTASH_DEFAULT_LOCALE),
  };
  return { config, problems };
}

let memo: { config: Config; problems: string[] } | null = null;

function load() {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    // Images are built without a .env: nothing may depend on runtime config at build time.
    throw new Error('config() was called during `next build`. Read configuration at request time only.');
  }
  if (!memo) memo = loadConfig(process.env);
  return memo;
}

/** The runtime configuration, parsed once (lazily). */
export function config(): Config {
  return load().config;
}

/** Every problem found in the environment, by variable name. */
export function configProblems(): string[] {
  return load().problems;
}

/** Boot check: throws a ConfigError listing every bad variable. */
export function assertConfig(): Config {
  const { config: c, problems } = load();
  if (problems.length) throw new ConfigError(problems);
  return c;
}

/** Tests only: forget the parsed configuration so the next read sees `process.env` again. */
export function resetConfig(): void {
  memo = null;
}

/** Settings the browser may read (`GET /api/v1/config`). Never includes a secret. */
export function publicConfig() {
  const c = config();
  return {
    appUrl: c.appUrl,
    googleClientId: c.GOOGLE_CLIENT_ID ?? null,
    features: c.features,
    version: c.version,
    defaultLocale: c.defaultLocale,
  };
}

export type PublicConfig = ReturnType<typeof publicConfig>;
