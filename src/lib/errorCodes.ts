// Story 3.5: stable error codes, shared by the server and the client.
// The server answers `{ code, message }` (REST) or a GraphQL error with
// `extensions.code`; `message` is an English developer string that is never
// shown. The client renders `errors.codes.<CODE>` from messages. Only codes
// that have a message there count as codes: system error codes such as
// ENOSPC, ERR_NETWORK or Prisma's P2025 are not. Pure apart from the
// English messages (the source locale), so `node --test` can load it.
import en from "../../messages/en.json" with { type: "json" };

/** Every code the client can render: the keys of `errors.codes`. */
const KNOWN_CODES: ReadonlySet<string> = new Set(Object.keys(en.errors.codes));

/** True when `code` is a stable code with a message in `errors.codes`. */
export function isKnownErrorCode(code: unknown): code is string {
  return typeof code === "string" && KNOWN_CODES.has(code);
}

/** Extra values a server error may carry for the message (ICU arguments). */
export type ErrorDetails = Record<string, string | number>;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null;
}

function codeIn(v: unknown): string | null {
  if (!isObj(v)) return null;
  if (isKnownErrorCode(v.code)) return v.code;
  if (isKnownErrorCode(v.errorCode)) return v.errorCode;
  if (isObj(v.extensions)) return codeIn(v.extensions);
  return null;
}

/** The first GraphQL-shaped error inside an Apollo error, a REST body or a payload. */
function carrier(err: unknown): Obj | null {
  if (!isObj(err)) return null;
  if (codeIn(err)) return err;
  const lists: unknown[] = [];
  if (Array.isArray(err.graphQLErrors)) lists.push(...err.graphQLErrors);
  if (Array.isArray(err.errors)) lists.push(...err.errors);
  const net = err.networkError;
  if (isObj(net) && isObj(net.result)) {
    if (Array.isArray(net.result.errors)) lists.push(...net.result.errors);
    else lists.push(net.result);
  }
  if (isObj(err.body)) lists.push(err.body);
  if (isObj(err.cause)) lists.push(err.cause);
  for (const e of lists) if (codeIn(e)) return e as Obj;
  return null;
}

/**
 * Stable code of a server error, or null (also null for a code without a
 * message, such as ENOSPC). Reads, in order: `code` /
 * `errorCode` on the value itself (REST body, admin payload), `extensions.code`,
 * then the first coded error in `graphQLErrors`, `networkError.result` or `cause`.
 */
export function errorCodeOf(err: unknown): string | null {
  const c = carrier(err);
  return c ? codeIn(c) : null;
}

/**
 * Message arguments a coded error carries next to its code (for example
 * `attemptsLeft`, `maxLength`, `retryAfter`): every string or number field of
 * the error body or its `extensions`, except `code` and `message`.
 */
export function errorDetailsOf(err: unknown): ErrorDetails {
  const c = carrier(err);
  if (!c) return {};
  const out: ErrorDetails = {};
  const take = (src: unknown) => {
    if (!isObj(src)) return;
    for (const [k, v] of Object.entries(src)) {
      if (k === "code" || k === "errorCode" || k === "message") continue;
      if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
    }
  };
  take(c);
  take(c.extensions);
  return out;
}

/** How a failure without a known code is described to the user. */
export type ErrorKind = "offline" | "session" | "forbidden" | "notFound" | "timeout" | "server" | "generic";

function statusOf(err: Obj): number | null {
  const net = isObj(err.networkError) ? err.networkError : null;
  for (const v of [err.status, err.statusCode, net?.statusCode, net?.status]) {
    if (typeof v === "number") return v;
  }
  return null;
}

/**
 * Classifies a failure from its structure only (code, HTTP status, error
 * class), never from message text. Pure.
 */
export function errorKind(err: unknown): ErrorKind {
  if (!isObj(err)) return "generic";
  const code = errorCodeOf(err);
  if (code === "UNAUTHENTICATED") return "session";
  if (code === "FORBIDDEN") return "forbidden";
  if (code === "NOT_FOUND") return "notFound";
  const name = typeof err.name === "string" ? err.name : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  const status = statusOf(err);
  if (status === 401) return "session";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 408 || status === 504) return "timeout";
  if (status !== null && status >= 500) return "server";
  // fetch() rejects with a TypeError when the network is down.
  if (err instanceof TypeError || (isObj(err.networkError) && status === null)) return "offline";
  return "generic";
}
