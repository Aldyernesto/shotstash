'use client';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import PlaygroundClient from 'fumadocs-openapi/ui/playground/client';
import { createGraphQLPage } from '@fumadocs/graphql/ui';
import { demoOrigin } from '@/lib/site';

/** Only `/api/*` answers cross-origin requests (SHOTSTASH_CORS_ORIGINS); `/media` and `/s` never do. */
export function playgroundAllowed(path: string): boolean {
  return path.startsWith('/api/');
}

/**
 * REST reference pages. The try-it console exists only in a build with
 * DEMO_ORIGIN (Story 8.2): the document's only server is then the public
 * demo, so the console can never point at a user's own install. Routes
 * outside `/api` get no console, since the demo sends no CORS headers there.
 */
export const OpenAPIPage = createOpenAPIPage({
  playground: {
    enabled: Boolean(demoOrigin),
    render: ({ path, method }) =>
      playgroundAllowed(path) ? (
        <PlaygroundClient />
      ) : (
        <div className="not-prose flex flex-row items-center gap-2 rounded-xl border bg-fd-card p-3 text-sm">
          <span className="font-mono font-medium">{method.toUpperCase()}</span>
          <code>{path}</code>
          <span className="text-fd-muted-foreground">No try-it console: the demo answers cross-origin requests on /api only.</span>
        </div>
      ),
  },
});

/** GraphQL reference pages, without a playground. */
export const GraphQLPage = createGraphQLPage({});
