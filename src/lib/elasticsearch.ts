// Shotstash — Elasticsearch Client
// Layer 4: Data Access

import { Client } from '@elastic/elasticsearch';
import { config } from './config';
import { logger } from './logger';

const log = logger('elasticsearch');

const globalForElastic = globalThis as unknown as {
  esClient: Client | undefined;
};

/**
 * The Elasticsearch client, created on first use, or null when
 * `ELASTICSEARCH_NODE_URL` is not set (search then uses PostgreSQL only).
 */
export function esClient(): Client | null {
  const node = config().ELASTICSEARCH_NODE_URL;
  if (!node) return null;
  if (!globalForElastic.esClient) {
    globalForElastic.esClient = new Client({ node, maxRetries: 1, requestTimeout: 5000 });
  }
  return globalForElastic.esClient;
}

/**
 * Ensures the basic indices exist on startup.
 */
export async function initializeElasticsearch() {
  const client = esClient();
  if (!client) return;
  try {
    const indexName = 'media_files';
    const exists = await client.indices.exists({ index: indexName });

    if (!exists) {
      await client.indices.create({
        index: indexName,
        mappings: {
          properties: {
            id: { type: 'keyword' },
            filename: { type: 'keyword' },
            originalName: {
              type: 'text',
              analyzer: 'standard',
              fields: {
                keyword: { type: 'keyword', ignore_above: 256 },
              },
            },
            mimeType: { type: 'keyword' },
            category: { type: 'keyword' },
            projectId: { type: 'keyword' },
            uploadedById: { type: 'keyword' },
            createdAt: { type: 'date' },
          },
        },
      });
      log.info('created index', { index: indexName });
    } else {
      log.info('index already exists', { index: indexName });
    }
  } catch (err) {
    log.error('initialization failed', { err });
  }
}

export default esClient;
