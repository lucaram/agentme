"use client";
import { useEffect, useState } from "react";
import { PollDraftSchema, type PollDraft } from "@/lib/chat/rich";
import { ChatDialog } from "./ChatDialog";

export function PollEditor({ conversationId, initial, onConfirm, onClose }: { conversationId: string; initial?: PollDraft | null; onConfirm: (poll: PollDraft, audience: string) => void; onClose: () => void }) {
  const [question, setQuestion] = useState(initial?.question ?? ""); const [options, setOptions] = useState(initial?.options ?? ["", ""]); const [people, setPeople] = useState<{ id: string; name: string; handle: string }[]>([]); const [selected, setSelected] = useState(initial?.people ?? []); const [choose, setChoose] = useState(false); const [loaded, setLoaded] = useState(false); const [error, setError] = useState("");
  useEffect(() => { const abort = new AbortController(); fetch(`/api/chats/${conversationId}/participants`, { signal: abort.signal }).then((r) => r.json()).then((r) => { if (r.error) throw new Error(r.error); setPeople(r.people); setChoose(r.choosePeople); setLoaded(true); }).catch((e) => { if (!abort.signal.aborted) setError(e.message); }); return () => abort.abort(); }, [conversationId]);
  return <ChatDialog label="Create poll" onClose={onClose}><form className="space-y-4 p-5" onSubmit={(e) => {
    e.preventDefault(); const parsed = PollDraftSchema.safeParse({ question, options, people: choose ? selected : [] });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Add a question and two different options.");
    if (!loaded || !people.length || (choose && !selected.length)) return setError("Choose at least one contact to vote with you.");
    onConfirm(parsed.data, choose ? people.filter((p) => selected.includes(p.id)).map((p) => p.name).join(", ") : "Everyone in this chat");
  }}>
    <div className="flex items-center justify-between"><h2 className="font-semibold">Create poll</h2><button type="button" className="btn-ghost" aria-label="Cancel poll" onClick={onClose}>✕</button></div>
    <label className="block text-sm">Question<input autoFocus className="input mt-1" maxLength={200} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pizza or sushi?" /></label>
    <div className="space-y-2">{options.map((option, i) => <div className="flex gap-2" key={i}><input className="input min-w-0 flex-1" aria-label={`Poll option ${i + 1}`} maxLength={100} value={option} placeholder={`Option ${i + 1}`} onChange={(e) => setOptions((old) => old.map((o, n) => n === i ? e.target.value : o))} />{options.length > 2 && <button type="button" className="btn-ghost" aria-label={`Remove poll option ${i + 1}`} onClick={() => setOptions((old) => old.filter((_, n) => n !== i))}>✕</button>}</div>)}</div>
    {options.length < 10 && <button type="button" className="text-sm text-accent" onClick={() => setOptions((old) => [...old, ""])}>+ Add option</button>}
    {choose ? <fieldset className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-border p-3"><legend className="px-1 text-sm">Ask your contacts</legend>{people.map((p) => <label className="flex items-center gap-2 text-sm" key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, p.id] : old.filter((id) => id !== p.id))} />{p.name}<span className="text-xs text-muted">@{p.handle}</span></label>)}</fieldset> : <p className="hint">{loaded ? `${people.length + 1} people in this chat · one vote each` : "Loading people…"}</p>}
    {loaded && !people.length && <p className="hint">Polls need other people. Start one with your contacts in My Agent.</p>}
    {choose && <p className="hint">People who require approval will receive a group invitation.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <button type="submit" className="btn-primary" disabled={!loaded || !people.length}>Review poll</button>
  </form></ChatDialog>;
}
