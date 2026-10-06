import { createOpenAPI } from 'fumadocs-openapi/server';

/** The committed OpenAPI 3.1 document at the repository root (`npm run openapi` writes it). */
export const openapi = createOpenAPI({
  input: ['../openapi.json'],
});
