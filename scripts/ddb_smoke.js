/**
 * DynamoDB smoke test.
 *
 * Usage:
 *   AWS_REGION=us-east-1 DDB_KNOWLEDGE_TABLE=pythagoras_knowledge_state node scripts/ddb_smoke.js
 */
const { PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { getDdbDocClient } = require('../src/services/awsDynamo');

async function main() {
  const ddb = getDdbDocClient();
  const table = process.env.DDB_KNOWLEDGE_TABLE || 'pythagoras_knowledge_state';
  const pk = `user#smoke_${Date.now()}`;
  const item = { pk, user_id: 'smoke', updated_at: new Date().toISOString(), xp: 1, streak: 0, topics: { demo: 0.1 }, history: [] };

  await ddb.send(new PutCommand({ TableName: table, Item: item }));
  const read = await ddb.send(new GetCommand({ TableName: table, Key: { pk } }));
  console.log(JSON.stringify({ wrote: item, read: read.Item }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


