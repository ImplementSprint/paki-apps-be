-- =============================================================================
--  PakiPark — PostgreSQL Schema  (Canonical — aligned with NestJS models.ts)
--  Database : pakipark (Supabase)
--  Encoding : UTF-8
--
--  SOURCE OF TRUTH: This file and backend/src/database/models.ts must stay
--  in sync. NestJS drives sync({ alter: true }) on startup; this SQL file
--  is used for fresh-database setup or manual Supabase migration runs.
--
--  HOW TO APPLY
--  ────────────
--  Paste into Supabase → SQL Editor and run.
--  Or:  psql -U postgres -d pakipark -f schema.sql
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUMS  (safe – wrapped in DO blocks so re-running is idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE enum_users_role       AS ENUM ('customer', 'admin', 'teller', 'business_partner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_type_enum     AS ENUM ('sedan', 'suv', 'van', 'truck', 'motorcycle', 'hatchback', 'pickup');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE slot_type_enum        AS ENUM ('regular', 'handicapped', 'ev_charging', 'vip', 'motorcycle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE slot_status_enum      AS ENUM ('available', 'occupied', 'reserved', 'maintenance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE vehicle_allowed_enum  AS ENUM ('sedan', 'suv', 'van', 'truck', 'motorcycle', 'any');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE booking_status_enum   AS ENUM ('upcoming', 'active', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method_enum   AS ENUM ('GCash', 'PayMaya', 'Credit/Debit Card');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status_enum   AS ENUM ('paid', 'pending', 'partial', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE settings_category_enum AS ENUM ('system', 'security', 'notifications', 'payment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE upload_entity_enum    AS ENUM ('user_avatar', 'vehicle_or', 'vehicle_cr');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEQUENCE for booking reference numbers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS booking_reference_seq START WITH 1 INCREMENT BY 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: users
-- Matches NestJS User model in models.ts
-- profilePicture stores the PUBLIC URL of the uploaded avatar image
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               SERIAL            PRIMARY KEY,
  name             VARCHAR(255)      NOT NULL,
  email            VARCHAR(255)      NOT NULL,
  password         VARCHAR(255)      NOT NULL,
  phone            VARCHAR(50),
  role             enum_users_role   NOT NULL DEFAULT 'customer',
  "profilePicture" TEXT,                          -- URL of uploaded avatar
  address          JSONB             NOT NULL DEFAULT '{}',
  "dateOfBirth"    DATE,
  "isVerified"     BOOLEAN           NOT NULL DEFAULT FALSE,
  documents        JSONB             NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
CREATE        INDEX IF NOT EXISTS idx_users_role     ON users (role);
CREATE        INDEX IF NOT EXISTS idx_users_name     ON users (name);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: vehicles
-- Matches NestJS Vehicle model.
-- orDoc / crDoc store the PUBLIC URL of the uploaded PDF/image document.
-- isDefault: the customer's primary vehicle (used in booking pre-fill).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id            SERIAL               PRIMARY KEY,
  "userId"      INTEGER              NOT NULL,
  brand         VARCHAR(100),
  model         VARCHAR(100),
  "plateNumber" VARCHAR(20)          NOT NULL,
  type          vehicle_type_enum    NOT NULL DEFAULT 'sedan',
  color         VARCHAR(30),
  "orDoc"       TEXT,                            -- URL of uploaded OR document
  "crDoc"       TEXT,                            -- URL of uploaded CR document
  "isDefault"   BOOLEAN              NOT NULL DEFAULT FALSE,
  "createdAt"   TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_user  ON vehicles ("userId");
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles ("plateNumber");

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: locations
-- Matches NestJS Location model.
-- isActive: TRUE = publicly bookable, FALSE = hidden from customer search.
-- hourlyRate: used for booking cost calculations.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS locations (
  id               SERIAL         PRIMARY KEY,
  name             VARCHAR(255)   NOT NULL,
  address          TEXT,
  lat              FLOAT,
  lng              FLOAT,
  "totalSpots"     INTEGER        NOT NULL DEFAULT 0,
  "availableSpots" INTEGER        NOT NULL DEFAULT 0,
  "hourlyRate"     FLOAT          NOT NULL DEFAULT 50,
  "pricePerHour"   FLOAT          NOT NULL DEFAULT 50,   -- NestJS alias
  "imageUrl"       TEXT,
  "operatingHours" JSONB          NOT NULL DEFAULT '{}',
  amenities        TEXT[]         NOT NULL DEFAULT '{}',
  coordinates      JSONB          NOT NULL DEFAULT '{}',
  "ownerId"        INTEGER,
  "isActive"       BOOLEAN        NOT NULL DEFAULT TRUE,
  "createdAt"      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT locations_owner_unique UNIQUE ("ownerId")
);

CREATE INDEX IF NOT EXISTS idx_locations_active ON locations ("isActive");
CREATE INDEX IF NOT EXISTS idx_locations_lat_lng ON locations (lat, lng);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: parking_slots
-- Matches NestJS ParkingSlot model AND parking-slots.service.ts queries.
-- label    : slot identifier e.g. "A1", "F2-B3"
-- section  : group letter e.g. "A", "B"
-- floor    : floor number (1 = ground)
-- status   : current state enum
-- vehicleTypeAllowed: restricts which vehicle type can park here
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parking_slots (
  id                   SERIAL                PRIMARY KEY,
  "locationId"         INTEGER               NOT NULL,
  label                VARCHAR(20)           NOT NULL,
  section              VARCHAR(10)           NOT NULL DEFAULT 'A',
  floor                INTEGER               NOT NULL DEFAULT 1,
  type                 slot_type_enum        NOT NULL DEFAULT 'regular',
  status               slot_status_enum      NOT NULL DEFAULT 'available',
  "vehicleTypeAllowed" vehicle_allowed_enum  NOT NULL DEFAULT 'any',
  "createdAt"          TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  CONSTRAINT parking_slots_location_label_unique UNIQUE ("locationId", label)
);

CREATE INDEX IF NOT EXISTS idx_parking_slots_location_layout
  ON parking_slots ("locationId", floor, section);

CREATE INDEX IF NOT EXISTS idx_parking_slots_location_status
  ON parking_slots ("locationId", status);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: bookings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id               SERIAL                PRIMARY KEY,
  "userId"         INTEGER               NOT NULL,
  "vehicleId"      INTEGER               NOT NULL,
  "locationId"     INTEGER               NOT NULL,
  "parkingSlotId"  INTEGER,
  reference        VARCHAR(30)           UNIQUE,
  barcode          VARCHAR(50)           UNIQUE,
  spot             VARCHAR(20)           NOT NULL,
  date             DATE                  NOT NULL,
  "timeSlot"       VARCHAR(20)           NOT NULL,
  type             VARCHAR(50)           NOT NULL DEFAULT '1-Hour Slot',
  status           booking_status_enum   NOT NULL DEFAULT 'upcoming',
  amount           FLOAT                 NOT NULL CHECK (amount >= 0),
  "paymentMethod"  payment_method_enum   NOT NULL,
  "paymentStatus"  payment_status_enum   NOT NULL DEFAULT 'pending',
  "checkInAt"      TIMESTAMPTZ,
  "checkOutAt"     TIMESTAMPTZ,
  "cancelledAt"    TIMESTAMPTZ,
  "cancelReason"   TEXT,
  "finalAmount"    FLOAT,
  -- Denormalised snapshot columns (no JOINs needed for display)
  "userName"        VARCHAR(120),
  "userEmail"       VARCHAR(200),
  "userPhone"       VARCHAR(30),
  "vehicleBrand"    VARCHAR(60),
  "vehicleModel"    VARCHAR(60),
  "vehiclePlate"    VARCHAR(20),
  "vehicleType"     VARCHAR(20),
  "vehicleColor"    VARCHAR(30),
  "locationName"    VARCHAR(200),
  "locationAddress" VARCHAR(400),
  "createdAt"       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Active bookings per location+date (most critical hot path)
CREATE INDEX IF NOT EXISTS idx_bookings_location_date_active
  ON bookings ("locationId", date)
  WHERE status IN ('upcoming', 'active');

-- Per-slot conflict check
CREATE INDEX IF NOT EXISTS idx_bookings_slot_date_active
  ON bookings ("parkingSlotId", date)
  WHERE "parkingSlotId" IS NOT NULL AND status IN ('upcoming', 'active');

-- Customer booking list (paginated, newest-first)
CREATE INDEX IF NOT EXISTS idx_bookings_user_createdat
  ON bookings ("userId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_user_status     ON bookings ("userId", status);
CREATE INDEX IF NOT EXISTS idx_bookings_date            ON bookings (date);
CREATE INDEX IF NOT EXISTS idx_bookings_status          ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_location_status ON bookings ("locationId", status);

-- Barcode scanner lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_barcode
  ON bookings (barcode)
  WHERE barcode IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: payment_methods
-- Stores saved payment methods linked by customers (GCash, etc.)
-- SCRUM-1014 (GCash Link) / SCRUM-1018 (Auto-Charge)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_methods (
  id             SERIAL       PRIMARY KEY,
  "userId"       INTEGER      NOT NULL,
  provider       VARCHAR(30)  NOT NULL DEFAULT 'GCash',  -- 'GCash' | 'PayMaya' | 'card'
  mobile_number  VARCHAR(20),                             -- 09XXXXXXXXX
  display_label  VARCHAR(60),                             -- e.g. "GCash •••• 1234"
  is_default     BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_payment_methods_user
    FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods ("userId");

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: operating_hours
-- Stores per-day open/close schedule for each parking location.
-- Partner Operating Hours story.
-- day_of_week: 0 = Sunday … 6 = Saturday
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operating_hours (
  id            SERIAL   PRIMARY KEY,
  "locationId"  INTEGER  NOT NULL,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time     TIME,                          -- NULL if is_closed = true
  close_time    TIME,
  is_closed     BOOLEAN  NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_operating_hours_location
    FOREIGN KEY ("locationId") REFERENCES locations(id) ON DELETE CASCADE,
  CONSTRAINT uq_operating_hours_location_day
    UNIQUE ("locationId", day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_operating_hours_location ON operating_hours ("locationId");

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: reviews
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id           SERIAL        PRIMARY KEY,
  "userId"     INTEGER       NOT NULL,
  "locationId" INTEGER       NOT NULL,
  "bookingId"  INTEGER,
  rating       SMALLINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  "userName"     VARCHAR(120),
  "locationName" VARCHAR(200),
  "createdAt"  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT reviews_booking_unique UNIQUE ("bookingId")
);

CREATE INDEX IF NOT EXISTS idx_reviews_location ON reviews ("locationId");
CREATE INDEX IF NOT EXISTS idx_reviews_user     ON reviews ("userId");

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: settings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  id          SERIAL        PRIMARY KEY,
  key         VARCHAR(100)  NOT NULL,
  value       JSONB         NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT settings_key_unique UNIQUE (key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: parking_rates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parking_rates (
  id            SERIAL       PRIMARY KEY,
  "locationId"  INTEGER,
  type          VARCHAR(20),
  rate          FLOAT,
  "createdAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: transaction_logs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_logs (
  id          SERIAL       PRIMARY KEY,
  "bookingId" INTEGER,
  "userId"    INTEGER,
  type        VARCHAR(30),
  amount      FLOAT,
  details     JSONB        NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: activity_logs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id           SERIAL       PRIMARY KEY,
  "adminId"    INTEGER,
  action       VARCHAR(100),
  "targetType" VARCHAR(50),
  "targetId"   INTEGER,
  details      JSONB        NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: uploads
-- Tracks every file uploaded by a customer (profile pictures, OR/CR docs).
-- The actual bytes live on the server or in object storage;
-- only the public URL + metadata is stored here.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
  id              SERIAL               PRIMARY KEY,
  "userId"        INTEGER              NOT NULL,
  "entityType"    upload_entity_enum   NOT NULL,
  "entityId"      INTEGER              NOT NULL,   -- FK to users.id or vehicles.id
  filename        VARCHAR(255)         NOT NULL,   -- stored filename on disk
  "originalName"  VARCHAR(255),                   -- original filename from client
  "mimeType"      VARCHAR(100),                   -- e.g. image/jpeg, application/pdf
  size            INTEGER,                        -- bytes
  url             TEXT                 NOT NULL,  -- publicly accessible URL/path
  "createdAt"     TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uploads_user   ON uploads ("userId");
CREATE INDEX IF NOT EXISTS idx_uploads_entity ON uploads ("entityType", "entityId");

-- =============================================================================
-- VIEWS  (read-only — aligned with actual table columns above)
-- =============================================================================

-- Active slot occupancy per location for today
CREATE OR REPLACE VIEW v_location_occupancy_today AS
SELECT
  l.id                                             AS "locationId",
  l.name                                           AS "locationName",
  l."totalSpots",
  l."availableSpots",
  COUNT(b.id) FILTER (WHERE b.status = 'active')   AS "occupiedNow",
  COUNT(b.id) FILTER (WHERE b.status = 'upcoming') AS "reservedToday",
  COUNT(b.id) FILTER (WHERE b.status = 'completed'
                       AND b.date = CURRENT_DATE)  AS "completedToday",
  ROUND(
    100.0 * COUNT(b.id) FILTER (WHERE b.status IN ('active','upcoming'))
    / NULLIF(l."totalSpots", 0), 1
  )                                                AS "occupancyPct"
FROM locations l
LEFT JOIN bookings b
  ON b."locationId" = l.id
  AND b.date = CURRENT_DATE
  AND b.status IN ('upcoming', 'active', 'completed')
WHERE l."isActive" = TRUE
GROUP BY l.id, l.name, l."totalSpots", l."availableSpots";

-- Slot-level status for today
CREATE OR REPLACE VIEW v_slot_status_today AS
SELECT
  ps.id                                       AS "slotId",
  ps."locationId",
  ps.label,
  ps.section,
  ps.floor,
  ps.type                                     AS "slotType",
  CASE
    WHEN ps.status = 'maintenance'            THEN 'maintenance'
    WHEN b.id IS NULL                         THEN 'available'
    WHEN b.status = 'active'                  THEN 'occupied'
    ELSE 'reserved'
  END                                         AS "derivedStatus",
  b.id                                        AS "bookingId",
  b.reference                                 AS "bookingRef",
  b."timeSlot",
  b.status                                    AS "bookingStatus",
  b.amount
FROM parking_slots ps
LEFT JOIN bookings b
  ON b."parkingSlotId" = ps.id
  AND b.date = CURRENT_DATE
  AND b.status IN ('upcoming', 'active');

-- =============================================================================
-- NOTES
-- =============================================================================
--
-- Column decisions vs old Express schema:
--
--   vehicles:  Removed "isActive" (NestJS uses hard-delete).
--              Added "isDefault" (marks customer's primary vehicle).
--              orDoc / crDoc now store uploaded file URLs, not base64.
--
--   locations: Uses "isActive" BOOLEAN (NestJS Location model) instead of
--              status enum. Add status enum later if needed.
--
--   parking_slots: Uses status slot_status_enum + label/section/floor columns
--              matching the NestJS service queries.
--
--   uploads:   New table. Tracks profile pictures and vehicle docs.
--              Actual files stored on server disk or S3-compatible storage.
--
-- =============================================================================