/**
 * Story 7.3: next-openapi-gen configuration for `openapi.json` at the
 * repository root. Run `npm run openapi` (scripts/gen-openapi.mjs), not the
 * generator CLI directly: the wrapper also maps the auth modes to security
 * schemes, marks byte answers with their media types, sorts the document and
 * validates it as OpenAPI 3.1. `npm run openapi:check` fails when the
 * committed file is stale.
 *
 * Only handlers tagged `@openapi` are included; the route coverage test
 * (scripts/route-coverage.test.mjs) requires the tag on every route. Request
 * and response shapes come from the type-only contract files in
 * `src/lib/apiContract` and `src/modules/pipeline/contract.ts`.
 *
 * No server host, demo origin or token is embedded: `servers` is `/`, so the
 * document describes whichever instance serves it.
 */
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const config = {
  openapi: '3.1.0',
  info: {
    title: 'Shotstash REST API',
    version: pkg.version,
    description:
      'REST routes of a Shotstash instance: auth, uploads, media, share pages, health and the processing worker contract (v1). ' +
      'Everything else (projects, files, sharing, discussion, jobs in the UI) is GraphQL at /api/graphql; see schema.graphql. ' +
      'Errors answer `{ code, message }` with a stable code. Until first-run setup is done every route except health, config and setup answers 503 SETUP_REQUIRED.',
    license: { name: 'MIT', identifier: 'MIT' },
  },
  servers: [{ url: '/', description: 'The instance serving this document' }],
  tags: [
    { name: 'Auth', description: 'Sign in and out; the Bearer token and the media cookie.' },
    { name: 'System', description: 'Health, runtime config, first-run setup and instance status.' },
    { name: 'Uploads', description: 'Resumable upload parts and cover images. Uploads start and complete through GraphQL.' },
    { name: 'Media', description: 'File bytes, thumbnails, processed versions and ZIPs under /media.' },
    { name: 'Share', description: 'Data of public and private share pages under /s/{slug}.' },
    { name: 'Pipeline', description: 'Worker contract v1: register, heartbeat, claim, input, output, progress, complete, fail, release.' },
    { name: 'GraphQL', description: 'The GraphQL endpoint. The schema reference is schema.graphql.' },
  ],
  components: {
    securitySchemes: {
      SessionToken: {
        type: 'http',
        scheme: 'bearer',
        description: 'Session token from POST /api/v1/auth/login or the login mutation, sent as `Authorization: Bearer <token>`.',
      },
      SessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'shotstash_session',
        description: 'The same session as an HttpOnly cookie scoped to /media (set by login and POST /api/v1/auth/cookie). Only /media routes read it.',
      },
      ShareCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'shotstash_share_{slug}',
        description: 'Access to a PRIVATE share link, set by POST /s/{slug}/unlock and scoped to /s/{slug}. The real cookie name ends with the link slug. PUBLIC links need no cookie.',
      },
      WorkerToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Worker-Token',
        description: 'Per-worker token returned once by worker registration.',
      },
      WorkerBootstrapToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Worker-Bootstrap-Token',
        description: 'The shared WORKER_BOOTSTRAP_TOKEN of the instance; accepted by worker registration only.',
      },
    },
  },

  apiDir: './src/app',
  routerType: 'app',
  schemaType: 'typescript',
  schemaDir: ['./src/lib/apiContract', './src/modules/pipeline'],
  includeOpenApiRoutes: true,
  outputDir: '.',
  outputFile: 'openapi.json',
  cache: false,
  debug: false,
};

export default config;
