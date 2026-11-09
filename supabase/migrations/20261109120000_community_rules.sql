-- Community rules: three core rules for every community (fixed in code) plus
-- up to five house rules picked from a list, and an optional main language.
-- The rules text members accept (and the autopilot reads) is built from these.
alter table public.communities
  add column language text check (language is null or language in ('en', 'it', 'es', 'fr', 'de', 'pt', 'nl', 'pl', 'ar', 'zh', 'ja', 'hi', 'mixed')),
  add column house_rules text[] not null default '{}' check (cardinality(house_rules) <= 5);

-- Existing communities: free-text rules become the three core rules.
update public.communities set rules = E'Be respectful.\nNo spam or selling.\nStay on topic.';
