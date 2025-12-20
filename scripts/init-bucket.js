require('dotenv').config();
const supabase = require('../src/config/supabase');

async function main() {
  const bucket = process.argv[2] || 'school-ai';
  try {
    console.log('Initializing bucket:', bucket);
    // Try create bucket (ignore if exists)
    await supabase.storage.createBucket(bucket, { public: true })
      .catch((err) => console.warn('Bucket creation skipped (may already exist):', err?.message || err));
    // Ensure public flag enabled
    const { error } = await supabase.storage.updateBucket(bucket, { public: true });
    if (error) {
      console.error('updateBucket error:', error);
      process.exit(1);
    }
    console.log('Bucket is public:', bucket);
    process.exit(0);
  } catch (e) {
    console.error('Init bucket failed:', e);
    process.exit(1);
  }
}

main();


