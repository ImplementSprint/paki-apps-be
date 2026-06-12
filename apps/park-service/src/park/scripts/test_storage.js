require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function test() {
  console.log('Testing Supabase Storage connection...');
  console.log('URL:', process.env.SUPABASE_URL);

  // List all buckets
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('❌ Connection failed:', error.message);
    process.exit(1);
  }

  console.log('✅ Connected! Existing buckets:');
  if (buckets.length === 0) {
    console.log('   (no buckets yet — will create them now)');
  } else {
    buckets.forEach(b => console.log(`   - ${b.name} (${b.public ? 'public' : 'private'})`));
  }

  // Create 'avatars' bucket if missing
  const avatarExists = buckets.find(b => b.name === 'avatars');
  if (!avatarExists) {
    const { error: e } = await supabase.storage.createBucket('avatars', { public: true });
    if (e) console.warn('  ⚠ Could not create avatars bucket:', e.message);
    else    console.log('  ✅ Created bucket: avatars (public)');
  } else {
    console.log('  ✔  Bucket "avatars" already exists');
  }

  // Create 'vehicle-docs' bucket if missing
  const vehicleExists = buckets.find(b => b.name === 'vehicle-docs');
  if (!vehicleExists) {
    const { error: e } = await supabase.storage.createBucket('vehicle-docs', { public: true });
    if (e) console.warn('  ⚠ Could not create vehicle-docs bucket:', e.message);
    else    console.log('  ✅ Created bucket: vehicle-docs (public)');
  } else {
    console.log('  ✔  Bucket "vehicle-docs" already exists');
  }

  console.log('\n🎉 Supabase Storage is ready for uploads!');
}

test().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
