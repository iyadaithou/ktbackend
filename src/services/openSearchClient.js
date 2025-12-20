/**
 * OpenSearch client for AOSS (OpenSearch Serverless) with proper AWS SigV4 signing.
 * Uses the official @opensearch-project/opensearch client for reliable AOSS compatibility.
 */

const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

let _client = null;

function getRegion() {
  return process.env.OPENSEARCH_AWS_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}

function getEndpoint() {
  const ep = process.env.OPENSEARCH_ENDPOINT;
  if (!ep) throw new Error('Missing OPENSEARCH_ENDPOINT');
  return ep.replace(/\/+$/, '');
}

function getService() {
  // OpenSearch Service uses "es"; OpenSearch Serverless uses "aoss"
  const explicit = process.env.OPENSEARCH_SERVICE;
  if (explicit) return explicit;
  try {
    const ep = getEndpoint();
    if (ep.includes('.aoss.amazonaws.com') || ep.includes('aoss.amazonaws.com')) return 'aoss';
  } catch (_) {}
  return 'es';
}

function getIndex() {
  return process.env.OPENSEARCH_INDEX || 'pythagoras-kb';
}

function getClient() {
  if (_client) return _client;

  const endpoint = getEndpoint();
  const region = getRegion();
  const service = getService();

  _client = new Client({
    ...AwsSigv4Signer({
      region,
      service,
      getCredentials: defaultProvider(),
    }),
    node: endpoint,
  });

  return _client;
}

async function ensureKnnIndex({ dimension }) {
  const client = getClient();
  const index = getIndex();

  // Check if index exists
  const exists = await client.indices.exists({ index });
  if (exists.body) {
    return { index, created: false };
  }

  // Create a kNN index with vector field and metadata fields
  const service = getService();
  const body = {
    settings: service === 'aoss' ? { 'index.knn': true } : { index: { knn: true } },
    mappings: {
      properties: {
        scope: { type: 'keyword' },
        school_id: { type: 'keyword' },
        source: { type: 'keyword' },
        chunk_index: { type: 'integer' },
        content: { type: 'text' },
        embedding: {
          type: 'knn_vector',
          dimension: Number(dimension),
          method: {
            name: 'hnsw',
            space_type: 'l2',
            engine: 'faiss',
          },
        },
        created_at: { type: 'date' },
      },
    },
  };

  await client.indices.create({ index, body });
  return { index, created: true };
}

async function bulkIndex(docs) {
  const client = getClient();
  const index = getIndex();
  const service = getService();

  // AOSS (OpenSearch Serverless) does NOT support custom document IDs
  const isAoss = service === 'aoss';

  const operations = docs.flatMap((d) => {
    const { id, ...source } = d;
    // For AOSS: omit _id (auto-generated); for regular ES: include _id
    const action = isAoss
      ? { index: { _index: index } }
      : { index: { _index: index, _id: id } };
    return [action, source];
  });

  // AOSS doesn't support refresh parameter
  const bulkParams = { body: operations };
  if (service !== 'aoss') {
    bulkParams.refresh = true;
  }
  const resp = await client.bulk(bulkParams);

  if (resp.body.errors) {
    const firstErr = resp.body.items.find((it) => it.index?.error)?.index?.error;
    throw new Error(firstErr?.reason || 'OpenSearch bulk indexing had errors');
  }

  return {
    took: resp.body.took,
    indexed: resp.body.items.length,
  };
}

async function deleteBySource({ scope, schoolId, source }) {
  const client = getClient();
  const index = getIndex();

  const must = [
    { term: { scope } },
    { term: { source } },
  ];
  if (scope === 'school') must.push({ term: { school_id: String(schoolId) } });

  // AOSS doesn't support refresh parameter
  const service = getService();
  const deleteParams = {
    index,
    body: { query: { bool: { must } } },
  };
  if (service !== 'aoss') {
    deleteParams.refresh = true;
  }
  const resp = await client.deleteByQuery(deleteParams);

  return {
    deleted: resp.body.deleted,
  };
}

async function knnSearch({ scope, schoolId, vector, k = 8 }) {
  const client = getClient();
  const index = getIndex();

  const filter = [{ term: { scope } }];
  if (scope === 'school') filter.push({ term: { school_id: String(schoolId) } });

  const body = {
    size: Math.max(1, Number(k) || 8),
    query: {
      bool: {
        filter,
        must: [
          {
            knn: {
              embedding: {
                vector,
                k: Math.max(1, Number(k) || 8),
              },
            },
          },
        ],
      },
    },
    _source: ['source', 'chunk_index', 'content', 'school_id', 'scope'],
  };

  const resp = await client.search({ index, body });
  const hits = resp.body.hits?.hits || [];

  return hits.map((h) => ({
    id: h._id,
    score: h._score,
    ...h._source,
  }));
}

module.exports = {
  ensureKnnIndex,
  bulkIndex,
  deleteBySource,
  knnSearch,
  getClient,
  getIndex,
  getEndpoint,
  getService,
  getRegion,
};
