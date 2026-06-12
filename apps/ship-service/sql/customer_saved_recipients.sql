create schema if not exists account;

create table if not exists account.customer_saved_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  phone text not null,
  frequency integer not null default 1 check (frequency >= 1),
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_saved_recipients_user_phone_unique
  on account.customer_saved_recipients (user_id, phone);

create index if not exists customer_saved_recipients_user_frequency_idx
  on account.customer_saved_recipients (user_id, frequency desc, last_used_at desc);
