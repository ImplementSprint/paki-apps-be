/**
 * Database Seed Script (PostgreSQL / Sequelize)
 * Run: npm run seed   (from /src/backend/)
 *
 * Seeds the database with initial data for development.
 * Clears existing Users, Locations, ParkingRates, ParkingSlots.
 *
 * ⚠️  WARNING: This script DELETES all existing users, locations,
 * parking rates, and parking slots before re-inserting seed data.
 * NEVER run this against a production database with real user data.
 */
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
// Always resolve .env relative to this file's directory, not CWD
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

// ── Safety guard ─────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  console.error('❌  Seed script cannot run in production (NODE_ENV=production).');
  console.error('    Set NODE_ENV=development to bypass this check in a staging environment.');
  process.exit(1);
}

const { sequelize } = require('../config/db');
// Import associations so all models are registered
const { User, Location, ParkingRate, ParkingSlot } = require('../models/index');

// ── Helpers ──────────────────────────────────────────────────────────────────
function sizeForType(type) {
  if (type === 'motorcycle')               return 'compact';
  if (type === 'ev_charging' || type === 'vip') return 'large';
  return 'standard';
}

function buildSlots(locationId, sections, slotsPerSection, floors) {
  const slots = [];
  for (let floor = 1; floor <= floors; floor++) {
    for (const section of sections) {
      for (let i = 1; i <= slotsPerSection; i++) {
        const shortLabel = `${section}${i}`;
        const label = floors > 1 ? `F${floor}-${shortLabel}` : shortLabel;
        const isHandicapped = i === 1 && section === sections[0];
        const isEV = i === slotsPerSection && section === sections[sections.length - 1];
        const type = isHandicapped ? 'handicapped' : isEV ? 'ev_charging' : 'regular';
        slots.push({
          locationId,
          label,
          section,
          floor,
          type,
          size: sizeForType(type),
          status: 'available',
          vehicleTypeAllowed: 'any',
        });
      }
    }
  }
  return slots;
}

// ── Seed ──────────────────────────────────────────────────────────────────────
const seedDB = async () => {
  try {
    // Connect + sync tables
    await sequelize.authenticate();
    console.log('PostgreSQL connected for seeding…');
    
    // Drop views temporarily so the seed script doesn't crash on table alters
    await sequelize.query('DROP VIEW IF EXISTS v_location_occupancy_today CASCADE;');
    await sequelize.query('DROP VIEW IF EXISTS v_slot_status_today CASCADE;');
    
    try {
      await sequelize.sync({ alter: true });
      console.log('Tables synced.');
    } catch (syncError) {
      console.warn('⚠️  Table sync (alter) failed, but continuing seed: ' + syncError.message.split('\n')[0]);
    }

    // ── Clear existing seed data ────────────────────────────────────────────
    await ParkingSlot.destroy({ where: {} });
    await User.destroy({ where: {} });
    await Location.destroy({ where: {} });
    await ParkingRate.destroy({ where: {} });
    console.log('Existing data cleared.');

    // ── Admin user ──────────────────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash('Admin@123', 10);
    await User.create({
      name: 'PakiPark Admin',
      email: 'admin@pakipark.com',
      password: hashedPassword,
      phone: '9123456789',
      role: 'admin',
      isVerified: true,
    });
    console.log('Admin user created → admin@pakipark.com / Admin@123');

    // ── Teller user ─────────────────────────────────────────────────────────
    const hashedTellerPw = await bcrypt.hash('Teller@123', 10);
    await User.create({
      name: 'PakiPark Teller',
      email: 'teller@pakipark.com',
      password: hashedTellerPw,
      phone: '9987654321',
      role: 'teller',
      isVerified: true,
    });
    console.log('Teller user created → teller@pakipark.com / Teller@123');

    // ── Business Partner user ────────────────────────────────────────────────
    const hashedBPPw = await bcrypt.hash('Partner@123', 10);
    await User.create({
      name: 'Demo Business Partner',
      email: 'partner@pakipark.com',
      password: hashedBPPw,
      phone: '9111222333',
      role: 'business_partner',
      isVerified: true,
    });
    console.log('Business Partner created → partner@pakipark.com / Partner@123');

    // ── Locations ───────────────────────────────────────────────────────────
    const locations = await Location.bulkCreate([
      {
        name: 'Ayala Center',
        address: 'Makati Central Business District',
        lat: 14.5547,
        lng: 121.0244,
        totalSpots: 120,
        availableSpots: 45,
        hourlyRate: 50,
        status: 'active',
        operatingHours: '06:00 - 23:00',
        amenities: ['CCTV', 'Covered', 'EV Charging'],
      },
      {
        name: 'Robinsons Galleria',
        address: 'EDSA cor. Ortigas Avenue, Quezon City',
        lat: 14.5879,
        lng: 121.0594,
        totalSpots: 200,
        availableSpots: 78,
        hourlyRate: 50,
        status: 'active',
        operatingHours: '06:00 - 23:00',
        amenities: ['CCTV', 'Covered'],
      },
      {
        name: 'SM North EDSA',
        address: 'North Avenue cor. EDSA, Quezon City',
        lat: 14.657,
        lng: 121.0295,
        totalSpots: 300,
        availableSpots: 120,
        hourlyRate: 50,
        status: 'active',
        operatingHours: '06:00 - 23:00',
        amenities: ['CCTV', 'Covered', 'Wheelchair Access'],
      },
      {
        name: 'SM San Lazaro',
        address: 'Felix Huertas cor. A.H. Lacson St., Manila',
        lat: 14.6163,
        lng: 120.9825,
        totalSpots: 150,
        availableSpots: 65,
        hourlyRate: 50,
        status: 'active',
        operatingHours: '06:00 - 23:00',
        amenities: ['CCTV'],
      },
      {
        name: 'SM Mall of Asia (MOA)',
        address: 'Seaside Blvd, Pasay City',
        lat: 14.5351,
        lng: 120.9826,
        totalSpots: 500,
        availableSpots: 210,
        hourlyRate: 60,
        status: 'active',
        operatingHours: '06:00 - 23:00',
        amenities: ['CCTV', 'Covered', 'EV Charging', 'Wheelchair Access'],
      },
    ]);
    console.log(`${locations.length} locations created.`);

    // ── Parking Slots (auto-generated per location) ─────────────────────────
    const slotConfigs = [
      { idx: 0, sections: ['A', 'B', 'C'],             slotsPerSection: 8,  floors: 2 },
      { idx: 1, sections: ['A', 'B', 'C', 'D'],        slotsPerSection: 10, floors: 2 },
      { idx: 2, sections: ['A', 'B', 'C', 'D', 'E'],   slotsPerSection: 12, floors: 3 },
      { idx: 3, sections: ['A', 'B', 'C'],             slotsPerSection: 10, floors: 2 },
      { idx: 4, sections: ['A', 'B', 'C', 'D', 'E', 'F'], slotsPerSection: 16, floors: 4 },
    ];

    let totalSlots = 0;
    for (const cfg of slotConfigs) {
      const locId = locations[cfg.idx].id;
      const slotData = buildSlots(locId, cfg.sections, cfg.slotsPerSection, cfg.floors);
      await ParkingSlot.bulkCreate(slotData);
      totalSlots += slotData.length;
    }
    console.log(`${totalSlots} parking slots generated.`);

    // ── Parking Rates ───────────────────────────────────────────────────────
    await ParkingRate.bulkCreate([
      { vehicleType: 'Sedan',      hourlyRate: 50,  dailyRate: 300 },
      { vehicleType: 'SUV',        hourlyRate: 75,  dailyRate: 450 },
      { vehicleType: 'Motorcycle', hourlyRate: 30,  dailyRate: 180 },
      { vehicleType: 'Van',        hourlyRate: 80,  dailyRate: 500 },
      { vehicleType: 'Truck',      hourlyRate: 100, dailyRate: 600 },
    ]);
    console.log('Parking rates seeded.');

    console.log('\n✅  Database seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌  Seed error:', error);
    process.exit(1);
  }
};

seedDB();