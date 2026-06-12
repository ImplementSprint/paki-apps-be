const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://rregfrhtlmfktliijzpd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJyZWdmcmh0bG1ma3RsaWlqenBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzOTAzNTEsImV4cCI6MjA4Njk2NjM1MX0.XuN7GMEHjLURt8THBzhLqTwo1s-srZG8ufhHM3mrAZM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  console.log('Testing RPC...');
  const res = await supabase.schema('parcel').rpc('get_analytics_data');
  console.log('RPC Error:', res.error);
  if (res.data) {
    console.log('RPC Data type:', typeof res.data);
    if (res.data.items) {
      console.log('Items length:', res.data.items.length);
    } else {
      console.log('No items in data:', res.data);
    }
  }
}

test();
