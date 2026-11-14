-- Only a server-recorded offer can be escalated. Serialize each business's
-- incoming requests so deduplication and aggregate limits hold across workers.
alter table public.inbox_items add column handoff_key text;
create unique index inbox_pending_business_question on public.inbox_items (agent_id, from_agent, handoff_key)
  where status = 'open' and handoff_key is not null;

create function public.request_business_handoff(p_exchange uuid, p_caller uuid)
returns table (item_id uuid, created boolean, outcome text)
language plpgsql security definer set search_path = public as $$
declare
  e public.task_exchanges%rowtype;
  b public.agents%rowtype;
  offer jsonb;
  q text;
  k text;
  existing uuid;
  permitted boolean;
begin
  select * into e from public.task_exchanges where id = p_exchange and from_agent = p_caller;
  if not found then return query select null::uuid, false, 'invalid'; return; end if;
  offer := e.response->'data';
  q := trim(offer->>'question');
  if e.skill <> 'business.faq' or offer->>'type' is distinct from 'agentme.business.handoff_offer'
    or q is null or length(q) not between 1 and 1000
    or jsonb_typeof(offer->'faq_eligible') is distinct from 'boolean' then
    return query select null::uuid, false, 'invalid'; return;
  end if;
  select * into b from public.agents where id = e.to_agent and type = 'business' and contact_policy <> 'nobody';
  if not found then return query select null::uuid, false, 'invalid'; return; end if;
  -- Recheck block/contact policy at click time, including after an offer was made.
  if exists (select 1 from public.contacts where status = 'blocked' and
    ((requester_agent = p_caller and addressee_agent = b.id) or (requester_agent = b.id and addressee_agent = p_caller)))
    or (b.contact_policy = 'contacts_only' and not exists (select 1 from public.contacts where status = 'accepted' and
    ((requester_agent = p_caller and addressee_agent = b.id) or (requester_agent = b.id and addressee_agent = p_caller)))) then
    return query select null::uuid, false, 'invalid'; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(b.id::text, 0));
  -- Replays never reopen a completed request.
  select id into existing from public.inbox_items where exchange_id = e.id;
  if found then return query select existing, false, 'existing'; return; end if;
  k := md5(trim(regexp_replace(lower(q), '[^[:alnum:]]+', ' ', 'g')));
  select id into existing from public.inbox_items
    where agent_id = b.id and from_agent = p_caller and handoff_key = k and status = 'open';
  if found then return query select existing, false, 'existing'; return; end if;
  select allowed into permitted from public.rate_limit_hit('businessHandoffsPerCaller:' || p_caller || ':' || b.id, 86400, 10);
  if not permitted then return query select null::uuid, false, 'caller_limit'; return; end if;
  select allowed into permitted from public.rate_limit_hit('businessHandoffsPerBusiness:' || b.id, 86400, 50);
  if not permitted then return query select null::uuid, false, 'business_limit'; return; end if;
  insert into public.inbox_items(owner_id, agent_id, from_agent, exchange_id, kind, payload, handoff_key)
    values (b.owner_id, b.id, p_caller, e.id, 'question', jsonb_build_object(
      'kind', 'question', 'business', true, 'question', q, 'faq_eligible', offer->'faq_eligible'), k)
    returning id into existing;
  update public.task_exchanges set status = 'waiting_human', answered_by = null where id = e.id;
  return query select existing, true, 'created';
end $$;
revoke execute on function public.request_business_handoff(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_business_handoff(uuid, uuid) to service_role;
