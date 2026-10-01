// HTTP client for the Shotstash worker contract v1 (/api/v1/pipeline/*).
// Native fetch only. The worker token lives in memory; it is never logged.
import { createWriteStream } from 'node:fs';
import { openAsBlob } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ContractError } from './backoff.mjs';

export const CONTRACT = 1;
const JSON_TIMEOUT_MS = 30_000;

export class ContractClient {
  /**
   * @param {{ baseUrl: string, bootstrapToken: string, manifest: { name: string, version: string, kinds: string[] }, fetchImpl?: typeof fetch }} opts
   */
  constructor({ baseUrl, bootstrapToken, manifest, fetchImpl = fetch }) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.bootstrapToken = bootstrapToken;
    this.manifest = { ...manifest, contract: CONTRACT };
    this.fetch = fetchImpl;
    this.token = null;
    this.heartbeatSeconds = 30;
  }

  get registered() {
    return this.token !== null;
  }

  forgetToken() {
    this.token = null;
  }

  async #call(method, path, { body, headers = {}, signal, raw = false } = {}) {
    const init = {
      method,
      headers: { ...headers },
      signal: signal ?? AbortSignal.timeout(JSON_TIMEOUT_MS),
    };
    if (this.token && !headers['X-Worker-Bootstrap-Token']) init.headers['X-Worker-Token'] = this.token;
    if (body !== undefined) {
      if (body instanceof Blob) {
        init.body = body;
      } else {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
      }
    }
    const res = await this.fetch(`${this.base}${path}`, init);
    if (res.ok) return raw ? res : res.status === 204 ? null : res.json();
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      // Not every refusal has a JSON body (a proxy in between, for example).
    }
    const err = new ContractError(res.status, payload?.code, payload?.message);
    const retryAfter = Number(res.headers.get('retry-after'));
    if (Number.isFinite(retryAfter)) err.retryAfter = retryAfter;
    throw err;
  }

  #checkContract(res) {
    const major = Number(res?.contract);
    if (major && major !== CONTRACT) {
      throw new ContractError(0, 'CONTRACT_UNSUPPORTED', `The server speaks pipeline contract ${major}; this worker speaks ${CONTRACT}`);
    }
  }

  /** Exchanges the bootstrap token for this worker's own token. */
  async register() {
    const res = await this.#call('POST', '/api/v1/pipeline/workers/register', {
      body: { manifest: this.manifest },
      headers: { 'X-Worker-Bootstrap-Token': this.bootstrapToken },
    });
    this.#checkContract(res);
    this.token = res.token;
    this.heartbeatSeconds = Number(res.heartbeatSeconds) || 30;
    return { workerId: res.workerId, heartbeatSeconds: this.heartbeatSeconds, leaseSeconds: res.leaseSeconds };
  }

  /** Answers the ids of active jobs the worker no longer holds. */
  async heartbeat(activeJobIds) {
    const res = await this.#call('POST', '/api/v1/pipeline/workers/heartbeat', { body: { manifest: this.manifest, activeJobIds } });
    this.#checkContract(res);
    return res.lostJobIds ?? [];
  }

  /** The next job, or null when there is nothing to do. */
  async next() {
    const res = await this.#call('POST', '/api/v1/pipeline/jobs/next', { body: {} });
    return res?.job ?? null;
  }

  /** Streams the job input into `path` (the whole file, so an MP4 with its index at the end works). */
  async downloadInput(job, path, signal) {
    const res = await this.#call('GET', `/api/v1/pipeline/jobs/${job.id}/input`, {
      headers: { 'X-Claim-Token': job.claimToken },
      signal,
      raw: true,
    });
    if (!res.body) throw new Error('The input stream is empty');
    await pipeline(Readable.fromWeb(res.body), createWriteStream(path), { signal });
  }

  progress(job, percent) {
    return this.#call('POST', `/api/v1/pipeline/jobs/${job.id}/progress`, {
      body: { progress: percent },
      headers: { 'X-Claim-Token': job.claimToken },
    });
  }

  /** Uploads the one output of the job as a raw streamed body. */
  async uploadOutput(job, path, { mimeType, ext, signal }) {
    const blob = await openAsBlob(path, { type: mimeType });
    return this.#call('PUT', `/api/v1/pipeline/jobs/${job.id}/output`, {
      body: blob,
      headers: { 'X-Claim-Token': job.claimToken, 'Content-Type': mimeType, 'X-Output-Ext': ext },
      signal,
    });
  }

  complete(job) {
    return this.#call('POST', `/api/v1/pipeline/jobs/${job.id}/complete`, { body: {}, headers: { 'X-Claim-Token': job.claimToken } });
  }

  fail(job, error, retryable) {
    return this.#call('POST', `/api/v1/pipeline/jobs/${job.id}/fail`, {
      body: { error: String(error).slice(0, 2000), retryable },
      headers: { 'X-Claim-Token': job.claimToken },
    });
  }
}
