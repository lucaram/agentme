-- A message already removed by moderation keeps its moderation history and controls.
create or replace function public.preserve_deleted_message() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.deleted_at is null and new.deleted_at is not null and old.removed_at is not null then
    raise exception 'This message has already been removed.';
  end if;
  if old.deleted_at is not null then
    new.deleted_at:=old.deleted_at; new.removed_at:=old.removed_at;
    new.content:='Deleted message'; new.reply_to:=null;
    new.metadata:=case when old.metadata ? 'client_id' then jsonb_build_object('client_id',old.metadata->'client_id') else '{}'::jsonb end;
  end if;
  return new;
end $$;
