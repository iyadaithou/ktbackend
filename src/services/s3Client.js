const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

function getAwsRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
}

let _s3 = null;

function getS3Client() {
  if (_s3) return _s3;
  _s3 = new S3Client({ region: getAwsRegion() });
  return _s3;
}

async function listS3Objects({ bucket, prefix, maxKeys = 1000 }) {
  const s3 = getS3Client();
  const out = [];
  let ContinuationToken = undefined;
  do {
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: Math.min(1000, maxKeys),
      ContinuationToken,
    }));
    const items = Array.isArray(resp?.Contents) ? resp.Contents : [];
    for (const it of items) {
      if (it?.Key) out.push({ key: it.Key, size: it.Size || 0, lastModified: it.LastModified });
      if (out.length >= maxKeys) break;
    }
    if (out.length >= maxKeys) break;
    ContinuationToken = resp?.IsTruncated ? resp?.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out;
}

async function getS3ObjectBuffer({ bucket, key }) {
  const s3 = getS3Client();
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = resp?.Body;
  if (!body) return Buffer.from('');
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = {
  getS3Client,
  listS3Objects,
  getS3ObjectBuffer,
};


