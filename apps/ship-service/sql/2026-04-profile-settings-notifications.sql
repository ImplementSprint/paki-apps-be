-- Account service profile settings patch.
-- Apply the shared base schema first, then this patch.
-- This keeps the database aligned with the NestJS TypeScript backend.

alter table account.profiles
  add column if not exists notification_preferences jsonb not null default '{}'::jsonb;
