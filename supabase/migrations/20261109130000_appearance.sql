-- Personalise: how the app looks to its person (theme, accent, text size, dark style).
-- Saved on the person's own agent so it follows them to every device; the app also
-- keeps it in a cookie to draw pages in the right colours straight away.
alter table public.agents add column if not exists appearance jsonb not null default '{}'::jsonb;
