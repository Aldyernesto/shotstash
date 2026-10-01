/**
 * Story 7.3: shapes of health, ping, runtime config, setup, status and the
 * GraphQL endpoint. Type-only and alias-free (see `common.ts`).
 */

/**
 * Health of the instance, served before first-run setup. Everyone gets `ok`,
 * `setupRequired` and `version`; a loopback client (the TCP peer, never a
 * forwarded header) or a Bearer session whose account may configure the
 * instance (`instance.configure`) also gets `db`, `cache`, `storage` and
 * `schemeMismatch`. The status is 200 when every dependency answers and 503
 * (same body, `ok: false`) when one is down.
 */
export type HealthResponse = {
  /** True when the database, the cache and storage all answer. */
  ok: boolean;
  /** True until first-run setup has created the super admin. */
  setupRequired: boolean;
  /** Running version (`SHOTSTASH_VERSION` in the image, else package.json). */
  version: string;
  /** Detailed body only: the database answers. */
  db?: boolean;
  /** Detailed body only: Dragonfly answers. */
  cache?: boolean;
  /** Detailed body only: the storage backend is reachable. */
  storage?: boolean;
  /** Detailed body only: the request scheme differs from `APP_URL` (a proxy without `TRUST_PROXY=true`). */
  schemeMismatch?: boolean;
};

/** Liveness answer. */
export type PingResponse = {
  /** Always true. */
  ok: true;
  /** Server time in milliseconds since the epoch. */
  time: number;
};

/** Feature switches, set by the operator. */
export type FeatureFlags = {
  /** Self sign-up is open (`SHOTSTASH_FEATURE_SIGNUP`). */
  signup: boolean;
  /** Google sign-in is configured. */
  google: boolean;
  /** Elasticsearch search is configured. */
  search: boolean;
  /** Password reset email can be sent. */
  passwordResetEmail: boolean;
  /** Project discussion is on (`SHOTSTASH_FEATURE_DISCUSSION`). */
  discussion: boolean;
};

/** Public runtime settings for the browser. Never carries a secret. */
export type PublicConfigResponse = {
  /** Public URL of the instance, without a trailing slash. */
  appUrl: string;
  /** Google OAuth client id, or null when Google sign-in is off. */
  googleClientId: string | null;
  /** Feature switches. */
  features: FeatureFlags;
  /** Running version. */
  version: string;
  /** Default UI locale, such as `en`. */
  defaultLocale: string;
};

/** The first super admin. */
export type SetupRequest = {
  /** Display name, 1 to 80 characters. */
  name: string;
  /** Account email. */
  email: string;
  /** Password, 10 to 256 characters. */
  password: string;
  /** The same password again. */
  confirm: string;
  /** Required when the operator set `SETUP_TOKEN`: the same value. */
  setupToken?: string;
};

/** Queue figures by state. */
export type JobCountsBody = {
  /** Queued with a live worker for the kind. */
  queued: number;
  /** Queued, but no live worker processes the kind. */
  waitingForWorker: number;
  /** Claimed by a worker, not started. */
  claimed: number;
  /** Being processed. */
  running: number;
  /** Finished in the last 24 hours. */
  done24h: number;
  /** Failed in the last 24 hours. */
  failed24h: number;
  /** Cancelled in the last 24 hours. */
  cancelled24h: number;
};

/** Storage backend status. */
export type StorageStatus = {
  /** `local` or `s3` (`STORAGE_BACKEND`). */
  backend: string;
  /** The backend answers. */
  reachable: boolean;
};

/** Instance status for the `/status` page. */
export type StatusResponse = {
  /** Running version. */
  version: string;
  /** Storage backend status. */
  storage: StorageStatus;
  /** The database answers. */
  database: boolean;
  /** Dragonfly answers. */
  cache: boolean;
  /** Elasticsearch search is configured. */
  search: boolean;
  /** Registered workers seen within the lease; null when the database cannot answer. */
  workers: number | null;
  /** Every queued job (with or without a live worker); null when the database cannot answer. */
  queuedJobs: number | null;
  /** Queue figures by state; null when the database cannot answer. */
  jobs: JobCountsBody | null;
};

/** A GraphQL operation (see `schema.graphql` for the schema). */
export type GraphQLRequest = {
  /** The GraphQL document. */
  query: string;
  /** Operation variables. */
  variables?: Record<string, unknown>;
  /** Which operation of the document to run. */
  operationName?: string;
};

/** A GraphQL result. */
export type GraphQLResponse = {
  /** The result, shaped by the query. */
  data?: Record<string, unknown> | null;
  /** Errors; each carries `extensions.code`. */
  errors?: Record<string, unknown>[];
};
