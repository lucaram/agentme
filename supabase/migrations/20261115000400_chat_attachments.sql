-- Attachment objects are private; only the authorised application server serves bytes.
insert into storage.buckets(id,name,public,file_size_limit) values('chat-attachments','chat-attachments',false,16777216)
on conflict(id) do update set public=false,file_size_limit=16777216;
create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  path text not null unique,
  name text not null check(char_length(name) between 1 and 160),
  mime text not null,
  kind text not null check(kind in ('image','video','audio','document')),
  bytes integer not null check(bytes between 1 and 16777216),
  created_at timestamptz not null default now()
);
create index chat_attachments_message on public.chat_attachments(message_id);
create index chat_attachments_uploader on public.chat_attachments(uploader_id,created_at);
alter table public.chat_attachments enable row level security;
revoke all on public.chat_attachments from anon,authenticated;
grant select(id,conversation_id,uploader_id,message_id,name,mime,kind,bytes,created_at) on public.chat_attachments to authenticated;
create policy chat_attachment_read on public.chat_attachments for select to authenticated using (
  exists(select 1 from public.messages m where m.id=message_id and m.removed_at is null)
);
create table public.chat_attachment_gc(path text primary key,created_at timestamptz not null default now());
create table public.chat_upload_usage(user_id uuid references auth.users(id) on delete cascade,day date,bytes bigint not null,primary key(user_id,day));
alter table public.chat_upload_usage enable row level security;
revoke all on public.chat_upload_usage from anon,authenticated;
alter table public.chat_attachment_gc enable row level security;
revoke all on public.chat_attachment_gc from anon,authenticated;

create function public.register_chat_attachment(p_id uuid,p_conversation uuid,p_user uuid,p_path text,p_name text,p_mime text,p_kind text,p_bytes integer)
returns void language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,10));
  if not exists(select 1 from public.conversation_members where conversation_id=p_conversation and user_id=p_user) then raise exception 'Not found'; end if;
  if (select coalesce(sum(bytes),0) from public.chat_attachments where uploader_id=p_user)+p_bytes>262144000 then raise exception 'Attachment storage limit reached'; end if;
  if coalesce((select bytes from public.chat_upload_usage where user_id=p_user and day=(now() at time zone 'UTC')::date),0)+p_bytes>104857600 then raise exception 'Daily upload limit reached'; end if;
  insert into public.chat_upload_usage values(p_user,(now() at time zone 'UTC')::date,p_bytes) on conflict(user_id,day) do update set bytes=public.chat_upload_usage.bytes+excluded.bytes;
  insert into public.chat_attachments(id,conversation_id,uploader_id,path,name,mime,kind,bytes)
  values(p_id,p_conversation,p_user,p_path,p_name,p_mime,p_kind,p_bytes);
end;
$$;
revoke execute on function public.register_chat_attachment(uuid,uuid,uuid,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.register_chat_attachment(uuid,uuid,uuid,text,text,text,text,integer) to service_role;

create function public.bind_chat_attachments() returns trigger language plpgsql security definer set search_path=public as $$
declare ids uuid[]; item public.chat_attachments; n integer:=0; total integer:=0;
begin
  if not(new.metadata ? 'attachment_ids') then return new; end if;
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(new.metadata->'attachment_ids');
  if coalesce(cardinality(ids),0)=0 then return new; end if;
  if cardinality(ids)>6 or new.sender_user_id is null then raise exception 'Invalid attachments'; end if;
  for item in select * from public.chat_attachments where id=any(ids) order by id for update loop
    if item.uploader_id<>new.sender_user_id or item.conversation_id<>new.conversation_id or item.message_id is not null then raise exception 'Invalid attachment owner'; end if;
    n:=n+1; total:=total+item.bytes;
  end loop;
  if n<>cardinality(ids) or total>33554432 then raise exception 'Invalid attachment selection'; end if;
  update public.chat_attachments set message_id=new.id where id=any(ids);
  return new;
end;
$$;
revoke execute on function public.bind_chat_attachments() from public,anon,authenticated;
create trigger messages_bind_attachments after insert on public.messages for each row execute function public.bind_chat_attachments();
create function public.queue_chat_attachment_delete() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.chat_attachment_gc(path) values(old.path) on conflict do nothing; return old; end;
$$;
revoke execute on function public.queue_chat_attachment_delete() from public,anon,authenticated;
create trigger attachment_deleted after delete on public.chat_attachments for each row execute function public.queue_chat_attachment_delete();
create function public.remove_message_attachments() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    delete from public.chat_attachments where message_id=new.id;
    if new.metadata->>'kind'='poll' then update public.plan_steps set status='done',result=coalesce(result,'{}'::jsonb)||'{"closed":true}'::jsonb where id::text=new.metadata->>'step_id'; end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.remove_message_attachments() from public,anon,authenticated;
create trigger message_media_removed after update of removed_at on public.messages for each row execute function public.remove_message_attachments();
