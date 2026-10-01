import { ApolloClient, InMemoryCache, HttpLink, split, from } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { getMainDefinition } from '@apollo/client/utilities';

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

  // Story 5.5: keep reconnecting (subscriptions resume), and tell listeners
  // after a reconnect so they refetch what they may have missed.
  let connectedOnce = false;
  const wsLink = new GraphQLWsLink(
    createClient({
      url: wsUrl,
      connectionParams: () => {
        const token = localStorage.getItem('shotstash_token');
        return { authorization: token ? `Bearer ${token}` : '' };
      },
      retryAttempts: Infinity,
      shouldRetry: () => true,
      on: {
        connected: () => {
          if (connectedOnce) window.dispatchEvent(new Event('shotstash:realtime-reconnected'));
          connectedOnce = true;
        },
      },
    })
  );

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
