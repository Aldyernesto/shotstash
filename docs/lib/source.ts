import { loader } from 'fumadocs-core/source';
import { docs } from 'collections/server';
import { graphql } from './graphql';
import { openapi } from './openapi';
import { i18n } from './i18n';

export const docsRoute = '/docs';

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    graphql: await graphql.staticSource({
      baseDir: 'api/graphql',
      meta: true,
    }),
    openapi: await openapi.staticSource({
      baseDir: 'api/rest',
      groupBy: 'tag',
      meta: true,
    }),
  },
  {
    baseUrl: docsRoute,
    i18n,
    plugins: [graphql.loaderPlugin(), openapi.loaderPlugin()],
  },
);
