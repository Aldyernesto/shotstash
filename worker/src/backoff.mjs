// What the worker does after a failed call. The rule of the contract: on
// 401, 503 or a network error, wait 30 s and try again; never exit.

export const BACKOFF_SECONDS = 30;

/** A refused contract call: HTTP status and the `code` of the `{ code, message }` body. */
export class ContractError extends Error {
  constructor(status, code, message) {
    super(message || `HTTP ${status}${code ? ` ${code}` : ''}`);
    this.name = 'ContractError';
    this.status = status;
    this.code = code ?? null;
  }
}

/**
 * Decision for an error thrown by the client:
 *   reregister  401: the token is unknown or revoked; register again after the wait
 *   backoff     503 (setup not done, storage down), 429, 5xx, network errors, contract mismatch
 *   retry       anything else (a short pause, then the loop goes on)
 */
export function classify(err) {
  if (err instanceof ContractError) {
    if (err.status === 401) return 'reregister';
    if (err.status === 503 || err.status === 429 || err.status >= 500) return 'backoff';
    if (err.code === 'CONTRACT_UNSUPPORTED') return 'backoff';
    return 'retry';
  }
  // fetch failures (connection refused or reset, DNS, timeouts) and aborted bodies.
  return 'backoff';
}

/** Seconds to wait: `Retry-After` for 429 when the server sent one, else the fixed backoff. */
export function waitSeconds(err, backoffSeconds = BACKOFF_SECONDS) {
  const kind = classify(err);
  if (kind === 'retry') return 5;
  if (err instanceof ContractError && err.status === 429 && Number.isFinite(err.retryAfter) && err.retryAfter > 0) {
    return Math.min(err.retryAfter, 300);
  }
  return backoffSeconds;
}

/** Resolves after `ms`, or at once when `signal` aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
