"use client";
import { useEffect, useState } from "react";
import { receiptDetails } from "@/app/(app)/receipt-actions";
import { receiptDisplay, type Receipt } from "@/lib/chat/receipts";
import { ChatDialog } from "./ChatDialog";
import { LocalTime } from "@/components/LocalTime";

export function MessageReceipt({ messageId, summary }: { messageId: string; summary?: Receipt }) {
  const [open, setOpen] = useState(false); const [details, setDetails] = useState<Receipt | null>(null); const [failed, setFailed] = useState(false);
  const version = JSON.stringify(summary);
  useEffect(() => {
    if (!open) return; let live = true;
    void receiptDetails(messageId).then((data) => { if (live) { setDetails(data); setFailed(!data); } }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [open, messageId, version]);
  const display = receiptDisplay(summary);
  return <>
    <button type="button" className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 text-[10px] hover:bg-accent-soft ${display.green ? "text-emerald-600 dark:text-emerald-400" : "text-muted"}`} aria-label={`Message status: ${display.label}`} title={`${display.label} · Show details`} data-testid="message-receipt" data-state={display.state} onClick={() => { setDetails(null); setFailed(false); setOpen(true); }}>
      <svg aria-hidden viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {display.icon === "up" ? <path d="M12 20V4m-6 6 6-6 6 6" /> : display.icon === "inbox" ? <><path d="M12 3v11m-5-5 5 5 5-5" /><path d="M4 13v7h16v-7" /></> : display.icon === "agent" ? <><rect x="4" y="6" width="16" height="14" rx="3" /><path d="M12 2v4M8 11v2m8-2v2m-8 3h8" /></> : <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
      </svg>
      {display.text}
    </button>
    {open && <ChatDialog label="Message status" onClose={() => setOpen(false)}><section className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Message status</h2><button type="button" aria-label="Close message status" className="btn-ghost" onClick={() => setOpen(false)}>✕</button></div>
      {failed ? <p className="text-sm text-muted">Receipt details are unavailable. Please try again.</p> : !details ? <p className="text-sm text-muted">Loading…</p> : <>
        <p className="text-xs text-muted">Sent · <LocalTime iso={details.sent_at} /></p>
        {details.kind === "untracked" ? <p className="text-sm text-muted">Delivery and seen tracking started after this message was sent.</p> : details.kind === "agent" ? <div className="space-y-3 text-sm">
          <p>{details.agent_name ?? "Agent"}</p>
          <p>Agent received: {details.agent_received_at ? <LocalTime iso={details.agent_received_at} /> : "No acknowledgement recorded"}</p>
          {details.agent_business && <p>Seen by business owner: {details.owner_seen_at ? <LocalTime iso={details.owner_seen_at} /> : details.owner_seen_shared ? "No human view recorded" : "Seen status not shared"}</p>}
          <p className="hint">An automatic reply does not confirm human viewing.</p>
        </div> : <>
          {details.group && details.total > 0 && <p className="text-sm font-medium">Seen by {details.seen} of {details.total}</p>}
          {!details.total && <p className="text-sm text-muted">No other recipients when this message was sent.</p>}
          <ul className="divide-y divide-border text-sm" aria-label="Receipt recipients">{details.recipients.map((person, index) => <li key={person.user_id ?? index} className="space-y-1 py-3"><p className="font-medium">{person.name}</p><p className="hint">Delivered: {person.delivered_at ? <LocalTime iso={person.delivered_at} /> : "No acknowledgement recorded"}</p><p className="hint">Seen: {person.seen_at ? <LocalTime iso={person.seen_at} /> : person.seen_shared ? "No seen receipt" : "Not shared"}</p></li>)}</ul>
        </>}
      </>}
    </section></ChatDialog>}
  </>;
}
