const { getLocations } = require('./controllers/locationController');
const { sequelize } = require('./config/db');

const req = {
  user: {
    authId: '3e658c3c-2812-4700-9dec-efb7bb440e26', // partner1 authId
    role: 'business_partner'
  },
  query: {}
};

const res = {
  status: function(code) {
    console.log('Status:', code);
    return this;
  },
  json: function(data) {
    console.log('JSON Output:');
    console.dir(data, { depth: null });
  }
};

async function testLocations() {
  try {
    await getLocations(req, res);
  } catch (err) {
    console.error('Crash in getLocations:', err);
  }
  process.exit(0);
}

testLocations();
