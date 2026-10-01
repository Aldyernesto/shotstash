/**
 * Worker contract constants (Story 5.2), shared by `defineRoute` (the
 * `worker` auth mode) and the pipeline module. Pure and alias-free, so
 * `node --test` imports it directly.
 *
 * Contract version 1: every response under `/api/v1/pipeline/*` carries
 * `X-Shotstash-Pipeline: 1`. A breaking change bumps this number, the path
 * version and the major release.
 */

export const PIPELINE_CONTRACT_VERSION = 1;

/** Response header naming the contract major the app speaks. */
export const PIPELINE_HEADER = 'X-Shotstash-Pipeline';
/** Per-worker token (every route except registration). */
export const WORKER_TOKEN_HEADER = 'X-Worker-Token';
/** Shared bootstrap token (`WORKER_BOOTSTRAP_TOKEN`), accepted by registration only. */
export const WORKER_BOOTSTRAP_HEADER = 'X-Worker-Bootstrap-Token';
/** Claim token of the job a call acts on. */
export const CLAIM_TOKEN_HEADER = 'X-Claim-Token';
/** Extension of an uploaded output (`mp4`, `jpg`, ...). */
export const OUTPUT_EXT_HEADER = 'X-Output-Ext';

/** Seconds between worker heartbeats the app expects. */
export const HEARTBEAT_SECONDS = 30;

/** Path prefix of the contract. */
export const PIPELINE_PATH_PREFIX = '/api/v1/pipeline/';
