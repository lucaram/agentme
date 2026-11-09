-- ↩ Reply: a message can quote an earlier message in the same chat. It points to
-- the original (not a copy), so when the original is removed the quote says so.
alter table public.messages add column reply_to uuid references public.messages (id) on delete set null;
create index messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;
