-- Parcel service-owned reviews.
-- Cross-service identifiers are plain UUID values only.

create schema if not exists parcel;

create table if not exists parcel.parcel_reviews (
  id uuid primary key default gen_random_uuid(),
  parcel_draft_id uuid not null,
  reviewer_id uuid not null,
  rating integer not null check (rating between 1 and 5),
  review_text text,
  tags text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists parcel_reviews_draft_reviewer_unique
  on parcel.parcel_reviews (parcel_draft_id, reviewer_id);

create index if not exists parcel_reviews_reviewer_created_idx
  on parcel.parcel_reviews (reviewer_id, created_at desc);
