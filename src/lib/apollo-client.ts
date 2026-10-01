import { ApolloClient, InMemoryCache, HttpLink, split, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

/** graphql-ws close codes for refused connections (bad or missing session): never retried. */
const AUTH_CLOSE_CODES = new Set([4400, 4401, 4403, 4406, 4409, 4429]);

let activeWsClient: ReturnType<typeof createClient> | null = null;

/** Story 5.5: closes the realtime connection (logout); a later subscription opens a fresh one with the new token. */
export function disposeRealtime() {
  const c = activeWsClient;
  if (!c) return;
  // Close and let graphql-ws reconnect lazily on the next subscription.
  c.terminate();
}

export function makeApolloClient() {
  const isBrowser = typeof window !== "undefined";

  const httpLink = new HttpLink({
    uri: isBrowser ? '/api/graphql' : 'http://127.0.0.1:3005/api/graphql',
  });

  const authLink = setContext((_, { headers }) => {
    const token = isBrowser ? localStorage.getItem('shotstash_token') : null;
    return {
      headers: {
        ...headers,
        authorization: token ? `Bearer ${token}` : "",
      }
    }
  });

  if (!isBrowser) {
    return new ApolloClient({
      ssrMode: true,
      link: authLink.concat(httpLink),
      cache: new InMemoryCache({
        typePolicies: {
          Project: { fields: { folders: { merge: false }, chats: { merge: false } } },
          ProjectSummary: { fields: { folders: { merge: false } } },
          Folder: { fields: { children: { merge: false }, files: { merge: false } } },
        },
      }),
    });
  }

  // Error link: auto-logout when the session is gone (revoked, expired, user deactivated).
  // FORBIDDEN is a permission answer for a valid session and never logs out.
  const errorLink = onError(({ graphQLErrors, networkError }) => {
    const authError =
      graphQLErrors?.some((e) =>
        e.extensions?.code === 'UNAUTHENTICATED' ||
        e.message === 'Unauthorized'
      ) ||
      networkError?.message?.includes('401');
    if (authError && typeof window !== 'undefined') {
      localStorage.removeItem('shotstash_user');
      localStorage.removeItem('shotstash_token');
      window.location.href = '/';
    }
  });

  // WebSocket link for subscriptions
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/api/graphql`;

  // Story 5.5: keep reconnecting after a dropped connection (subscriptions
  // resume) but never after an auth close; tell listeners only when a
  // connection replaces one that dropped (not after an idle lazy close).
  let dropped = false;
  const wsClient = createClient({
    url: wsUrl,
    connectionParams: () => {
      const token = localStorage.getItem('shotstash_token');
      return { authorization: token ? `Bearer ${token}` : '' };
    },
    retryAttempts: Infinity,
    shouldRetry: (event) => {
      const code = (event as { code?: number } | null)?.code;
      if (code !== undefined && AUTH_CLOSE_CODES.has(code)) return false;
      return !!localStorage.getItem('shotstash_token');
    },
    on: {
      closed: (event) => {
        const code = (event as { code?: number } | null)?.code;
        // 1000 is the lazy close after the last subscription ended.
        if (code !== 1000 && !AUTH_CLOSE_CODES.has(code ?? 0)) dropped = true;
      },
      connected: () => {
        if (dropped) window.dispatchEvent(new Event('shotstash:realtime-reconnected'));
        dropped = false;
      },
    },
  });
  activeWsClient?.dispose();
  activeWsClient = wsClient;
  const wsLink = new GraphQLWsLink(wsClient);


  // Split: subscription → wsLink, query/mutation → httpLink (with errorLink)
  const httpChain = from([errorLink, authLink, httpLink]);

  const splitLink = split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return (
        definition.kind === 'OperationDefinition' &&
        definition.operation === 'subscription'
      );
    },
    wsLink,
    httpChain,
  );

  return new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: { fetchPolicy: 'cache-and-network' as any },
      query: { fetchPolicy: 'cache-and-network' as any },
    },
  });
}
