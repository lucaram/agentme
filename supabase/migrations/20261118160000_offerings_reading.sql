-- While prices and facilities are being read from a source (cleared when the read ends): pages show
-- that it's happening. A value older than a few minutes is ignored (a read that never ended).
alter table public.business_sources add column offerings_reading_at timestamptz;
