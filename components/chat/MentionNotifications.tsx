"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MENTION_EVENT, MentionState } from "@/lib/chat/mentions";

type ChatMention = MentionState["chats"][number];
export function MentionBadge({ conversationId, initial }: { conversationId: string; initial?: ChatMention }) {
  const [current, setCurrent] = useState(initial); const [source, setSource] = useState(initial);
  if (initial !== source) { setSource(initial); setCurrent(initial); }
  useEffect(() => {
    const update = (event: Event) => setCurrent((event as CustomEvent<MentionState>).detail.chats.find((c) => c.conversation_id === conversationId));
    window.addEventListener(MENTION_EVENT, update); return () => window.removeEventListener(MENTION_EVENT, update);
  }, [conversationId]);
  return current?.total ? <Link href={`/chats/${conversationId}#m-${current.first_message}`} aria-label={`${current.total} unread ${current.total === 1 ? "mention" : "mentions"}`} className="mr-3 shrink-0 rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent" data-testid="mention-badge">@{current.total > 1 ? ` ${current.total > 99 ? "99+" : current.total}` : ""}</Link> : null;
}
export { MentionCenter as MentionNotifications, MentionsButton } from "./MentionCenter";
