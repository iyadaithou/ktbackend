/**
 * Smoke test for Bedrock from this backend project.
 *
 * Usage:
 *   AWS_REGION=us-east-1 BEDROCK_CHAT_MODEL_ID=<modelId> node scripts/bedrock_smoke.js
 */
const { generateMcq } = require('../src/services/bedrockTutor');

async function main() {
  const topic = process.argv[2] || 'derivatives';
  const level = Number(process.argv[3] || 2);
  const out = await generateMcq({ topic, level });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


