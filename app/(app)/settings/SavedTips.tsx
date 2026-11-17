"use client";
import { useId, useState, useTransition } from "react";
import { removeTipAction, saveTipAction } from "../people-actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { ShareTiles } from "@/components/profile/ShareTiles";

type Tip = { id: string; topic: string; tip: string; disclosure: "private" | "contacts" };

/** Each recommendation has its own explicit permission; edits require Save. */
export function SavedTips({ tips }: { tips: Tip[] }) {
  const [editing, setEditing] = useState<string | null>(null); const [pending, start] = useTransition();
  const [error, setError] = useState(""); const [message, setMessage] = useState(""); const [newVersion, setNewVersion] = useState(0);
  const saved = () => { setEditing(null); setMessage("Saved. Your agent uses this visibility straight away."); setNewVersion((n) => n + 1); };
  return <div className="space-y-4">
    {tips.length > 0 && <ul className="divide-y divide-border rounded-xl border border-border" data-testid="saved-tips">{tips.map((tip) => <li key={tip.id} className="space-y-3 px-3 py-3 text-sm">
      {editing === tip.id ? <TipEditor initial={tip} onSaved={saved} onCancel={() => setEditing(null)} /> : <div className="flex items-start gap-3"><span className="min-w-0 flex-1"><span className="block break-words font-medium">{tip.topic}</span><span className="block break-words text-muted">{tip.tip}</span><span className="mt-1 block text-xs text-accent">{tip.disclosure === "contacts" ? "👥 My contacts' agents" : "🔒 Only my agent"}</span></span><div className="flex shrink-0 gap-3"><button type="button" className="text-xs text-accent underline" disabled={pending} onClick={() => { setEditing(tip.id); setMessage(""); }}>Edit</button><button type="button" className="text-xs text-muted underline" disabled={pending} onClick={() => start(async () => { const result = await removeTipAction(tip.id); setError(result.error ?? ""); setMessage(""); })}>Remove</button></div></div>}
    </li>)}</ul>}
    {!editing && <div className="space-y-3"><h3 className="text-sm font-semibold">Add a tip</h3><TipEditor key={newVersion} onSaved={saved} /></div>}
    {message && <p role="status" className="text-xs text-accent">{message}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}

function TipEditor({ initial, onSaved, onCancel }: { initial?: Tip; onSaved: () => void; onCancel?: () => void }) {
  const name = useId(); const [topic, setTopic] = useState(initial?.topic ?? ""); const [tip, setTip] = useState(initial?.tip ?? "");
  const [share, setShare] = useState(initial?.disclosure === "contacts"); const [pending, start] = useTransition(); const [error, setError] = useState("");
  return <form className="space-y-4" aria-label={initial ? "Edit saved tip" : "Add saved tip"} onSubmit={(event) => {
    event.preventDefault(); start(async () => { const result = await saveTipAction({ ...(initial ? { id: initial.id } : {}), topic, tip, share }); setError(result.error ?? ""); if (!result.error) onSaved(); });
  }}>
    <div className="space-y-2"><label htmlFor={`${name}-topic`} className="block text-xs font-semibold uppercase tracking-wide text-muted">Topic</label><input id={`${name}-topic`} className="input" value={topic} disabled={pending} onChange={(event) => setTopic(event.target.value)} maxLength={80} minLength={2} required placeholder="e.g. plumber" aria-label="Tip topic" /></div>
    <div className="space-y-2"><label htmlFor={`${name}-tip`} className="block text-xs font-semibold uppercase tracking-wide text-muted">Your tip</label><AutoGrowTextarea id={`${name}-tip`} className="input" minRows={2} maxRows={5} value={tip} disabled={pending} onChange={(event) => setTip(event.target.value)} maxLength={500} required placeholder="e.g. Joe's Plumbing, 020 7946 0000" aria-label="Tip" /></div>
    <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted">Who can see this</p><ShareTiles share={share} onChange={setShare} name={`${name}-visibility`} disabled={pending} privateHint="Used for your own requests, never given to contacts' agents." contactsHint="Only when a contact asks for a recommendation about this topic." /></div>
    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    <div className="flex justify-end gap-3 border-t border-border pt-3">{onCancel && <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>Cancel</button>}<button type="submit" className="btn-primary" disabled={pending || topic.trim().length < 2 || !tip.trim()}>{pending ? "Saving…" : initial ? "Save tip" : "Add tip"}</button></div>
  </form>;
}
