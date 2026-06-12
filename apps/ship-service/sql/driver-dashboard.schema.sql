-- Driver service-owned tables.
-- Cross-service identifiers are plain UUID values only.

create schema if not exists driver;

create table if not exists driver.driver_profiles (
  id uuid primary key,
  vehicle_type text,
  license_number text,
  delivery_mode text,
  is_online boolean not null default false,
  acceptance_rate numeric,
  documents_status text
);

create table if not exists driver.driver_jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique,
  parcel_draft_id uuid,
  driver_id uuid,
  status text not null default 'available',
  earnings numeric not null default 0
);

create table if not exists driver.driver_earnings (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  job_id uuid,
  amount numeric not null default 0,
  earned_at timestamptz not null default timezone('utc', now())
);

create index if not exists driver_jobs_status_idx
  on driver.driver_jobs (status);

create index if not exists driver_jobs_driver_idx
  on driver.driver_jobs (driver_id, status);

create index if not exists driver_earnings_driver_earned_idx
  on driver.driver_earnings (driver_id, earned_at desc);
