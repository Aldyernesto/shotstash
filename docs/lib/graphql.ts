import { createGraphQL } from '@fumadocs/graphql/server';

/** The committed SDL at the repository root (`npm run sdl` writes it). */
export const graphql = createGraphQL({
  input: ['../schema.graphql'],
});
