const fs = require('fs');
const path = require('path');

const modelsDir = path.join(__dirname, 'models');
const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js') && f !== 'index.js');

const schemaMap = {
  ActivityLog: 'partner',
  Booking: 'reservation',
  Location: 'parking_lot',
  Notification: 'notifications',
  OperatingHours: 'parking_lot',
  ParkingRate: 'parking_lot',
  ParkingSlot: 'parking_lot',
  PaymentMethod: 'payment',
  Review: 'partner',
  Settings: 'teller',
  TransactionLog: 'reservation',
  Upload: 'teller',
  User: 'account',
  Vehicle: 'teller'
};

files.forEach(f => {
  const p = path.join(modelsDir, f);
  let content = fs.readFileSync(p, 'utf8');
  const modelName = f.replace('.js', '');
  const schemaName = schemaMap[modelName];

  if (schemaName && !content.includes("schema: '")) {
    // Regex to match tableName: '...', and append schema: '...',
    content = content.replace(/(tableName:\s*['"][a-zA-Z_]+['"],)/, `$1\n    schema: '${schemaName}',`);
    fs.writeFileSync(p, content);
    console.log('Updated ' + f + ' with schema ' + schemaName);
  } else {
    console.log('Skipped ' + f);
  }
});
