import { compareMessages, MAX_RENDERED_MESSAGES } from "@/lib/social/paging";
import type { HistoryBundle, HistoryMessage } from "./history-types";

function union<T>(groups: T[][], key: (value: T) => string) { return [...new Map(groups.flat().map((value) => [key(value), value])).values()]; }
export function messageWindow(groups: HistoryMessage[][], side: "before" | "after" | "replace") {
  const all = union(groups, (m) => m.id).sort(compareMessages);
  return { messages: side === "before" ? all.slice(0, MAX_RENDERED_MESSAGES) : all.slice(-MAX_RENDERED_MESSAGES), all };
}

/** Merge only the newly fetched chunks, prune both DOM rows and their related data. */
export function mergeHistory(base: HistoryBundle, pages: HistoryBundle[], mode: "before" | "after" | "replace" | "refresh"): HistoryBundle {
  if (!pages.length) return base;
  const groups = mode === "replace" || mode === "refresh" ? pages : [base, ...pages];
  const { messages, all } = messageWindow(groups.map((p) => p.messages), mode === "before" ? "before" : "after");
  const ids = new Set(messages.map((m) => m.id)); const quoteIds = new Set(messages.flatMap((m) => m.reply_to ? [m.reply_to] : []));
  const available = new Set(messages.filter((m) => !m.removed_at).map((m) => m.id));
  const metas = messages.map((m) => m.metadata as { task_id?: string; proposal_id?: string; step_id?: string; booking_business_id?: string });
  const proposalIds = new Set(metas.map((m) => m.proposal_id));
  const proposals = union(groups.map((p) => p.proposals), (p) => p.id).filter((p) => proposalIds.has(p.id));
  const taskIds = new Set([...metas.map((m) => m.task_id), ...proposals.map((p) => p.task_id)]);
  const tasks = union(groups.map((p) => p.tasks), (t) => t.id).filter((t) => taskIds.has(t.id));
  const steps = union(groups.map((p) => p.steps), (s) => s.id).filter((s) => taskIds.has(s.task_id)); const stepIds = new Set(steps.map((s) => s.id));
  const responses = union(groups.map((p) => p.responses), (r) => `${r.step_id}:${r.agent_id}`).filter((r) => stepIds.has(r.step_id));
  const claims = union(groups.map((p) => p.claims), (r) => `${r.step_id}:${r.item}`).filter((r) => stepIds.has(r.step_id));
  const exchanges = union(groups.map((p) => p.exchanges), (e) => e.id).filter((e) => e.task_id && taskIds.has(e.task_id));
  const quotes = union(groups.map((p) => p.quotes), (m) => m.id).filter((m) => quoteIds.has(m.id));
  const mentions = union(groups.map((p) => p.mentions ?? []), (m) => `${m.message_id}:${m.user_id}`).filter((m) => available.has(m.message_id));
  const owners = new Set([base.userId, ...messages.map((m) => m.sender_user_id), ...quotes.map((m) => m.sender_user_id)]);
  const actors = new Set([base.agent.id, ...messages.map((m) => m.sender_agent_id), ...quotes.map((m) => m.sender_agent_id), ...responses.map((r) => r.agent_id), ...claims.map((r) => r.agent_id), ...exchanges.flatMap((e) => [e.from_agent, e.to_agent])]);
  mentions.forEach((m) => actors.add(m.agent_id));
  const handles = new Set([...tasks.map((t) => t.parsed), ...proposals.map((p) => p.content), ...steps.map((s) => s.config)].flatMap((value) => { const v = value as { participants?: string[]; voters?: string[] }; return [...(v.participants ?? []), ...(v.voters ?? [])]; }));
  const actionIds = new Set([...metas.map((m) => m.booking_business_id), ...proposals.map((p) => (p.content as { venue?: { agent_id?: string } }).venue?.agent_id)]);
  const legacy = union(groups.map((p) => p.legacy), (entry) => entry[0]).filter(([id]) => ids.has(id)); legacy.forEach(([, id]) => actionIds.add(id));
  const newest = pages.at(-1)!;
  const firstPage = groups.find((p) => p.messages.some((m) => m.id === messages[0]?.id));
  const lastPage = [...groups].reverse().find((p) => p.messages.some((m) => m.id === messages.at(-1)?.id));
  const unreadIds = union(groups.map((p) => p.unreadIds), (id) => id).filter((id) => ids.has(id));
  const tailPruned = all.filter((m) => !ids.has(m.id) && compareMessages(m, messages.at(-1)!) > 0);
  return { ...newest, ...(newest.deletableMessageIds ? { deletableMessageIds: [...new Set(groups.flatMap((group) => group.deletableMessageIds ?? []))].filter((id) => ids.has(id)) } : {}), mentions, messages, firstUnread: base.firstUnread ?? newest.firstUnread, unreadIds,
    hasBefore: Boolean(firstPage?.hasBefore || (all[0] && messages[0] && compareMessages(all[0], messages[0]) < 0)),
    hasAfter: Boolean(lastPage?.hasAfter || tailPruned.length), unreadAfter: (lastPage?.unreadAfter ?? 0) + tailPruned.filter((m) => groups.some((p) => p.unreadIds.includes(m.id))).length,
    agents: union(groups.map((p) => p.agents), (a) => a.id).filter((a) => owners.has(a.owner_id) || actors.has(a.id) || handles.has(a.handle)),
    attachments: union(groups.map((p) => p.attachments), (a) => a.id).filter((a) => a.message_id && available.has(a.message_id)),
    tasks, proposals, steps, responses, claims, exchanges, quotes, receipts: union(groups.map((p) => p.receipts), (r) => r.message_id).filter((r) => available.has(r.message_id)),
    reactions: union(groups.map((p) => p.reactions), (r) => r.message_id).filter((r) => available.has(r.message_id)),
    actions: union(groups.map((p) => p.actions), (entry) => entry[0]).filter(([id]) => actionIds.has(id)), legacy,
  };
}
