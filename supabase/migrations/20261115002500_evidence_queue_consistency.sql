-- New independent reports deserve review even while an earlier reporter is being asked for evidence.
create function public.reopen_case_for_new_report() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.platform_cases set status='in_review',revision=revision+1,updated_at=now() where id=new.case_id and status='waiting_evidence';
  return null;
end $$;
revoke execute on function public.reopen_case_for_new_report() from public,anon,authenticated;
create trigger platform_new_report_review after insert on public.platform_reports for each row execute function public.reopen_case_for_new_report();

-- Older local reports retain their original excerpt when the source was already removed.
update public.reports r set evidence=jsonb_build_array(jsonb_build_object(
  'id',m.id,'content',case when m.removed_at is null then m.content else coalesce(r.excerpt,'Message removed') end,
  'at',m.created_at,'author',coalesce(a.display_name,'Former member'),'ai',m.is_ai_generated
)) from public.messages m left join public.agents a on a.id=m.sender_agent_id or (m.sender_agent_id is null and a.owner_id=m.sender_user_id)
where r.message_id=m.id and m.visible_to is null and r.evidence='[]'::jsonb;
