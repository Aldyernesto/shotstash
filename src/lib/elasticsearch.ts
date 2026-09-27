// Shotstash — Elasticsearch Client
// Layer 4: Data Access

import { Client } from '@elastic/elasticsearch';

const globalForElastic = globalThis as unknown as {
  esClient: Client | undefined;
};

export const esClient =
  globalForElastic.esClient ??
  new Client({
    node: process.env.ELASTICSEARCH_NODE_URL || 'http://127.0.0.1:9200',
    maxRetries: 1,
    requestTimeout: 5000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForElastic.esClient = esClient;
}

/**
 * Ensures the basic indices exist on startup.
 */
export async function initializeElasticsearch() {
  try {
    const indexName = 'media_files';
    const exists = await esClient.indices.exists({ index: indexName });

    if (!exists) {
      await esClient.indices.create({
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
      console.log(`[Elasticsearch] Created index: ${indexName}`);
    } else {
      console.log(`[Elasticsearch] Index ${indexName} already exists`);
    }
  } catch (error) {
    console.error('[Elasticsearch] Initialization failed:', error);
  }
}

export default esClient;
