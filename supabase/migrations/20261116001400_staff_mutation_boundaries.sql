-- JSON records let a shared trigger validate table-specific fields safely.
create or replace function public.guard_restricted_caller() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare actor_role text; next_row jsonb:=to_jsonb(new); previous_row jsonb:=to_jsonb(old);
begin
  if auth.uid() is not null then
    if not public.workspace_session_allowed() then raise exception 'This workspace is unavailable.'; end if;
    actor_role:=public.workspace_role();
    if actor_role='staff' then
      if tg_table_name not in ('rate_limits','inbox_items','presence_preferences','agent_threads','messages','message_reactions','message_reaction_versions','message_receipts','message_receipt_versions','message_views','message_receipt_tracking','conversation_members','mention_alerts','mention_versions','business_staff_availability','business_answer_drafts','business_question_claims') then raise exception 'Your business role does not allow this action.'; end if;
      if tg_table_name='presence_preferences' and (tg_op<>'UPDATE' or next_row->'visibility' is distinct from previous_row->'visibility' or next_row->'mode' is distinct from previous_row->'mode' or next_row->'mode_until' is distinct from previous_row->'mode_until') then raise exception 'Only owners and managers change business-wide settings'; end if;
      if tg_table_name='inbox_items' and (coalesce(next_row->>'owner_id',previous_row->>'owner_id') is distinct from public.workspace_user_id()::text or coalesce(next_row->>'kind',previous_row->>'kind') not in ('question','business_answer_review')) then raise exception 'Not allowed'; end if;
      if tg_table_name='messages' and tg_op='UPDATE' and previous_row->>'sender_user_id' is not null and not exists(select 1 from public.business_message_authors where message_id=(previous_row->>'id')::uuid and actor_id=auth.uid()) then raise exception 'You can only delete messages you personally sent for this business'; end if;
      if tg_table_name='conversation_members' and (tg_op<>'UPDATE' or next_row->'role' is distinct from previous_row->'role' or next_row->'user_id' is distinct from previous_row->'user_id' or next_row->'conversation_id' is distinct from previous_row->'conversation_id' or next_row->'history_from' is distinct from previous_row->'history_from') then raise exception 'Your business role does not allow this action'; end if;
      if tg_table_name='agent_threads' and (tg_op<>'UPDATE' or next_row->'title' is distinct from previous_row->'title' or next_row->'renamed' is distinct from previous_row->'renamed' or next_row->'owner_id' is distinct from previous_row->'owner_id') then raise exception 'Your business role does not allow this action'; end if;
    end if;
    if tg_table_name='agents' and tg_op='DELETE' and actor_role='manager' then raise exception 'Only an owner can delete a business'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;

-- Repeated taps/retries reuse a still-pending identical suggestion.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.suggest_business_answer(text,text)'::regprocedure);
  execute replace(definition,'insert into public.business_answer_drafts',
    'select id into draft from public.business_answer_drafts where business_agent_id=business and author_id=auth.uid() and question=trim(p_question) and answer=trim(p_answer) and status=''pending'' limit 1; if draft is not null then return draft; end if;
     insert into public.business_answer_drafts');
end $$;
