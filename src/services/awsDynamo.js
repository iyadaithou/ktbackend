const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

function getAwsRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}

let _doc = null;

function getDdbDocClient() {
  if (_doc) return _doc;
  const region = getAwsRegion();
  const client = new DynamoDBClient({ region });
  _doc = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return _doc;
}

module.exports = {
  getAwsRegion,
  getDdbDocClient,
};


