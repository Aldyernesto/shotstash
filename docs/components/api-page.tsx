'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import { createGraphQLPage } from '@fumadocs/graphql/ui';

/**
 * REST reference pages. The try-it console stays off until the public demo
 * instance exists; it must never point at a user's own install.
 */
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: false },
});

/** GraphQL reference pages, without a playground for the same reason. */
export const GraphQLPage = createGraphQLPage({});
