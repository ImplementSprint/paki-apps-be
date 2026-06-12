-- Notifications service-owned announcements consumed through service APIs.
-- Cross-service identifiers are plain UUID values only.

create schema if not exists notifications;

create table if not exists notifications.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  target_role text not null default 'all',
  target_service text not null default 'pakiship',
  created_by uuid,
  expires_at timestamptz
);

create index if not exists announcements_target_idx
  on notifications.announcements (target_service, target_role);
