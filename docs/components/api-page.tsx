'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import { createGraphQLPage } from '@fumadocs/graphql/ui';
import { demoOrigin } from '@/lib/site';

/**
 * REST reference pages. The try-it console exists only in a build with
 * DEMO_ORIGIN (Story 8.2): the document's only server is then the public
 * demo, so the console can never point at a user's own install.
 */
export const OpenAPIPage = createOpenAPIPage({
  playground: { enabled: Boolean(demoOrigin) },
});

/** GraphQL reference pages, without a playground. */
export const GraphQLPage = createGraphQLPage({});
