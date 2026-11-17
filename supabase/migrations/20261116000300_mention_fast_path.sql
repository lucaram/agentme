-- Ordinary chat traffic should not invoke mention parsing or membership reads.
drop trigger capture_mentions on public.messages;
create trigger capture_mentions after insert on public.messages for each row
  when (position('@' in new.content)>0) execute function public.capture_message_mentions();
create trigger clear_mentions after update of visible_to,removed_at,deleted_at on public.messages for each row
  when (new.visible_to is not null or new.removed_at is not null or new.deleted_at is not null)
  execute function public.capture_message_mentions();
