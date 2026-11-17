"use client";
import { Avatar } from "@/components/Avatar";

import { Fragment, useState } from "react";
import { createPortal } from "react-dom";
import type { Mention } from "@/lib/chat/mentions";
import { ChatDialog } from "./ChatDialog";

export function MentionText({ text, mentions, agents }: { text: string; mentions: Mention[]; agents: { id: string; handle: string; display_name: string; avatar: string }[] }) {
  const [selected, setSelected] = useState<Mention | null>(null); const profile = agents.find((a) => a.id === selected?.agent_id);
  const byHandle = new Map(mentions.map((m) => [m.handle.toLowerCase(), m]));
  const parts = text.split(/((?:^|[^\w@])@[a-z0-9_]{3,20}(?![a-z0-9_]))/gi);
  return <>{parts.map((part, i) => {
    const match = part.match(/^([\s\S]*?)@([a-z0-9_]+)$/i); const mention = match ? byHandle.get(match[2].toLowerCase()) : null;
    return mention && match ? <Fragment key={i}>{match[1]}<button type="button" className="person-mention rounded px-0.5 underline decoration-current/40 underline-offset-2" data-testid="person-mention" onClick={() => setSelected(mention)}>@{match[2]}</button></Fragment> : match ? <Fragment key={i}>{match[1]}<span className="person-mention">@{match[2]}</span></Fragment> : part;
  })}{selected && createPortal(<ChatDialog label="Mentioned person" onClose={() => setSelected(null)}><div className="space-y-3 p-5"><p className="text-4xl"><Avatar value={profile?.avatar ?? "👤"} /></p><h2 className="font-semibold">{profile?.display_name ?? "Former member"}</h2><p className="text-sm text-muted">@{profile?.handle ?? selected.handle} · Person</p><button type="button" className="btn-secondary" onClick={() => setSelected(null)}>Close profile</button></div></ChatDialog>, document.body)}</>;
}
