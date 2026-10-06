import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createOpenAPI } from 'fumadocs-openapi/server';
import { demoOrigin } from './site';

const DOCUMENT = '../openapi.json';

/**
 * The committed OpenAPI 3.1 document at the repository root (`npm run openapi`
 * writes it). Its only server is `/`. A build with DEMO_ORIGIN (Story 8.2)
 * points the try-it console at the public demo and nowhere else; the
 * committed file never names a host.
 */
export const openapi = createOpenAPI({
  input: demoOrigin
    ? {
        [DOCUMENT]: () => {
          const doc = JSON.parse(readFileSync(path.resolve(process.cwd(), DOCUMENT), 'utf8'));
          return { ...doc, servers: [{ url: demoOrigin, description: 'The public demo (read-only accounts, resets every night)' }] };
        },
      }
    : [DOCUMENT],
});
