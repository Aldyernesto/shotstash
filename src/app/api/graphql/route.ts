// Shotstash — Apollo Server Route
// Next.js App Router Handler

import { ApolloServer } from '@apollo/server';
import { startServerAndCreateNextHandler } from '@as-integrations/next';
import { NextRequest } from 'next/server';
import { typeDefs } from '../../../graphql/schema';
import { resolvers, GraphQLContext } from '../../../graphql/resolvers';
import * as AuthService from '../../../services/auth.service';
import { clientIp } from '../../../lib/clientIp';

const server = new ApolloServer<GraphQLContext>({
  typeDefs,
  resolvers,
  formatError: (formatted) => formatted,
});

const handler = startServerAndCreateNextHandler<NextRequest, GraphQLContext>(server, {
  context: async (req: NextRequest) => {
    // Basic Auth extraction via HttpOnly Cookie or Bearer Token
    const authHeader = req.headers.get('authorization');
    const sessionCookie = req.cookies.get('shotstash_session');
    
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (sessionCookie) {
      token = sessionCookie.value;
    }

    let userId: string | undefined;
    let sessionId: string | undefined;

    if (token) {
      const session = await AuthService.validateSession(token);
      if (session) {
        userId = session.user.id;
        sessionId = session.id;
      }
    }

    return {
      req,
      userId,
      sessionId,
      ip: clientIp(req.headers),
    };
  },
});

export async function GET(request: NextRequest) {
  return handler(request);
}

export async function POST(request: NextRequest) {
  return handler(request);
}
