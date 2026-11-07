-- Fix: group members could not read RSVPs (proposal_responses).
-- The old policy joined public.tasks inside the policy, and tasks are only
-- readable by their owner, so for every other group member the check was
-- silently false. A SECURITY DEFINER helper evaluates visibility without
-- depending on the caller's access to tasks.

create function public.can_see_proposal(p_proposal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.proposals pr
    join public.tasks t on t.id = pr.task_id
    where pr.id = p_proposal
      and (
        t.owner_id = auth.uid()
        or (pr.group_conversation_id is not null and public.is_conversation_member(pr.group_conversation_id))
      )
  )
$$;

drop policy proposal_responses_read on public.proposal_responses;
create policy proposal_responses_read on public.proposal_responses
  for select to authenticated using (public.can_see_proposal(proposal_id));

-- Same latent issue in the proposals policy (it worked only via its second branch).
drop policy proposals_read on public.proposals;
create policy proposals_read on public.proposals
  for select to authenticated using (public.can_see_proposal(id));
