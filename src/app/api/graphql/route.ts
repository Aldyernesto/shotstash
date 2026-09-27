// GraphQL endpoint (Apollo Server on the App Router).
//
// Story 2.1: declared `public` at the route level because each root field
// declares its own mode in `src/graphql/auth-map.ts`. The actor comes from
// the Bearer token only: the media cookie is scoped to /media and must never
// authorise a mutation (CSRF).

import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import { NextRequest } from 'next/server';
import { typeDefs } from '../../../graphql/schema';
import { resolvers, GraphQLContext } from '../../../graphql/resolvers';
import { serialize } from 'cookie';
import {
  SESSION_COOKIE,
  bearerToken,
  sessionCookieOptions,
  validateSessionToken,
  type ValidSession,
} from '@/lib/sessionStore';
import { clientIp } from '../../../lib/clientIp';
import { defineRoute } from '@/lib/defineRoute';

const server = new ApolloServer<GraphQLContext>({
  typeDefs,
  resolvers,
  formatError: (formatted) => formatted,
});

// Session resolved once per request by the route, read back by Apollo's context.
const sessions = new WeakMap<NextRequest, ValidSession | null>();

function contextFor(req: NextRequest): Pick<GraphQLContext, 'userId' | 'sessionId' | 'sessionToken' | 'actor'> {
  const session = sessions.get(req) ?? null;
  // Inactive (deactivated) users are treated as signed out.
  if (!session || !session.actor.active) return { sessionToken: bearerToken(req.headers) ?? undefined, actor: null };
  return { userId: session.actor.id, sessionId: session.id, sessionToken: session.token, actor: session.actor };
}

const handler = startServerAndCreateNextHandler<NextRequest, GraphQLContext>(server, {
  context: async (req: NextRequest) => ({
    req,
    ...contextFor(req),
    ip: clientIp(req.headers),
  }),
});

async function handle(req: NextRequest): Promise<Response> {
  const token = bearerToken(req.headers);
  const session = token ? await validateSessionToken(token) : null;
  sessions.set(req, session);
  const res = await handler(req);
  if (!session?.renewed || !session.actor.active) return res;

  // The session slid: refresh the media cookie so it expires with it.
  const o = sessionCookieOptions(req, session.expiresAt);
  const headers = new Headers(res.headers);
  headers.append(
    'Set-Cookie',
    serialize(SESSION_COOKIE, session.token, {
      httpOnly: o.httpOnly,
      sameSite: o.sameSite,
      path: o.path,
      secure: o.secure,
      expires: o.expires,
    }),
  );
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const route = defineRoute({
  auth: 'public',
  action: 'per field (src/graphql/auth-map.ts)',
  handler: ({ req }) => handle(req),
});

export const GET = route;
export const POST = route;
