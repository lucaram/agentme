-- Public change signals only. Never stream agents.business_info (it contains private customer information).
create table public.business_action_versions (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.business_action_versions enable row level security;
revoke all on public.business_action_versions from anon, authenticated;
grant select on public.business_action_versions to authenticated;
create policy business_action_versions_read on public.business_action_versions for select to authenticated using (true);
insert into public.business_action_versions(agent_id) select id from public.agents where type='business';

create function public.signal_business_actions() returns trigger
language plpgsql security definer set search_path = public as $$
declare business_id uuid;
begin
  if tg_table_name='agents' then
    if new.type<>'business' then
      delete from public.business_action_versions where agent_id=new.id;
      return new;
    end if;
    if tg_op='UPDATE' and new.business_info is not distinct from old.business_info and new.type=old.type then return new; end if;
    business_id:=new.id;
  else
    if tg_op='DELETE' then business_id:=old.agent_id; else business_id:=new.agent_id; end if;
  end if;
  if exists(select 1 from public.agents where id=business_id and type='business') then
    insert into public.business_action_versions(agent_id) values(business_id)
    on conflict(agent_id) do update set version=public.business_action_versions.version+1,updated_at=clock_timestamp();
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function public.signal_business_actions() from public,anon,authenticated;
create trigger agents_signal_actions after insert or update of business_info,type on public.agents for each row execute function public.signal_business_actions();
create trigger sites_signal_actions after insert or update or delete on public.business_sites for each row execute function public.signal_business_actions();
alter publication supabase_realtime add table public.business_action_versions;
