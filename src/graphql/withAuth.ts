/**
 * Story 2.1: wraps every root resolver with the auth mode declared in
 * `auth-map.ts`.
 *
 *   - `session` fields throw UNAUTHENTICATED without an active actor;
 *   - session mutations of a read-only account throw FORBIDDEN (reads work);
 *   - a resolver without an entry in the map stops the server at startup;
 *   - a map entry without a resolver gets one that answers NOT_IMPLEMENTED.
 */

import { GraphQLError } from 'graphql';
// Relative, extension-full imports so `node --test` can load this file directly.
// eslint-disable-next-line no-restricted-imports -- the module's public index, spelled as a file path
import { forbidden, unauthenticated, type Actor } from '../modules/auth/index.ts';
import { AUTH_MAP, ROOT_TYPES, type FieldAuth } from './auth-map.ts';

type AnyFn = (...args: never[]) => unknown;
type Ctx = { actor?: Actor | null } | undefined;

function guard(type: string, entry: FieldAuth, ctx: Ctx) {
  if (entry.auth === 'public') return;
  const actor = ctx?.actor;
  if (!actor || !actor.active) throw unauthenticated();
  if (type === 'Mutation' && actor.readOnly) throw forbidden('Forbidden: read-only account');
}

function notImplemented(type: string, field: string) {
  return () => {
    throw new GraphQLError(`${type}.${field} is not available over GraphQL`, {
      extensions: { code: 'NOT_IMPLEMENTED' },
    });
  };
}

function wrapFn(type: string, entry: FieldAuth, fn: AnyFn): AnyFn {
  return ((parent: unknown, args: unknown, ctx: Ctx, info: unknown) => {
    guard(type, entry, ctx);
    return (fn as unknown as (p: unknown, a: unknown, c: Ctx, i: unknown) => unknown)(parent, args, ctx, info);
  }) as unknown as AnyFn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyAuthMap<R extends Record<string, any>>(resolvers: R): R {
  const out: Record<string, unknown> = { ...resolvers };
  for (const type of ROOT_TYPES) {
    const map = AUTH_MAP[type];
    const given = (resolvers[type] ?? {}) as Record<string, unknown>;
    for (const field of Object.keys(given)) {
      if (!map[field]) throw new Error(`Resolver ${type}.${field} has no entry in src/graphql/auth-map.ts`);
    }
    const wrapped: Record<string, unknown> = {};
    for (const [field, entry] of Object.entries(map)) {
      const r = given[field];
      if (type === 'Subscription') {
        const sub = (r ?? { subscribe: notImplemented(type, field) }) as { subscribe: AnyFn; resolve?: AnyFn };
        wrapped[field] = { ...sub, subscribe: wrapFn(type, entry, sub.subscribe) };
      } else {
        wrapped[field] = wrapFn(type, entry, (typeof r === 'function' ? r : notImplemented(type, field)) as AnyFn);
      }
    }
    out[type] = wrapped;
  }
  return out as R;
}
