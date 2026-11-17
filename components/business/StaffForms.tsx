"use client";

import { useState, useTransition } from "react";
import { respondBusinessStaffInvite, suggestBusinessAnswer, reviewBusinessAnswer } from "@/app/(app)/business/staff-actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

async function attempt<T extends { error?: string }>(work: () => Promise<T>): Promise<T | { error: string }> { try { return await work(); } catch { return { error: "Couldn't save this change. Please try again." }; } }

export function BusinessInvitationForm({ id }: { id: string }) {
  const [pending, start] = useTransition(); const [error, setError] = useState(""); const [done, setDone] = useState(false);
  const respond = (accept: boolean) => start(async () => { const result = await attempt(() => respondBusinessStaffInvite(id, accept)); if (result.error) setError(result.error); else setDone(true); });
  return done ? <p role="status" className="text-sm text-accent">Your choice is saved. Accepted businesses appear in your account menu.</p> : <div className="space-y-2"><div className="flex gap-2"><button type="button" className="btn-primary" disabled={pending} onClick={() => respond(true)}>Accept invitation</button><button type="button" className="btn-ghost" disabled={pending} onClick={() => respond(false)}>Decline</button></div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</div>;
}
export function BusinessAnswerSuggestion({ approvalRequired = true }: { approvalRequired?: boolean }) {
  const [question, setQuestion] = useState(""); const [answer, setAnswer] = useState(""); const [message, setMessage] = useState(""); const [failed, setFailed] = useState(false); const [pending, start] = useTransition();
  return <form aria-label="Suggest an approved answer" className="space-y-3" onSubmit={(event) => { event.preventDefault(); start(async () => { const result = await attempt(() => suggestBusinessAnswer(question, answer)); setFailed(Boolean(result.error)); setMessage(result.error ?? ("published" in result && result.published ? "Published in Questions & Answers." : "Sent to an Owner or Manager for approval in My Agent.")); if (!result.error) { setQuestion(""); setAnswer(""); } }); }}>
    <h3 className="font-medium">{approvalRequired ? "Suggest an answer" : "Add an answer"}</h3><p className="hint">Use a general business question and a direct answer based on your confirmed policy.</p><input className="input" aria-label="Suggested question" placeholder="A question customers ask" maxLength={300} required value={question} onChange={(event) => setQuestion(event.target.value)} />
    <AutoGrowTextarea className="input" aria-label="Suggested answer" placeholder="Your proposed answer" minRows={2} maxRows={6} required maxLength={1000} value={answer} onChange={(event) => setAnswer(event.target.value)} />
    <button className="btn-primary" disabled={pending}>{approvalRequired ? "Send for approval" : "Publish answer"}</button>{message && <p role={failed ? "alert" : "status"} className={failed ? "text-sm text-danger" : "hint"}>{message}</p>}
  </form>;
}
export function BusinessAnswerReview({ id, question: initialQuestion, answer: initialAnswer, canApprove }: { id: string; question: string; answer: string; canApprove: boolean }) {
  const [question, setQuestion] = useState(initialQuestion); const [answer, setAnswer] = useState(initialAnswer); const [error, setError] = useState(""); const [pending, start] = useTransition(); const [done, setDone] = useState(false);
  if (!canApprove) return <p className="hint">An owner or manager will review this suggestion.</p>;
  const review = (approve: boolean) => start(async () => { const result = await attempt(() => reviewBusinessAnswer(id, approve, question, answer)); if (result.error) setError(result.error); else setDone(true); });
  return done ? <p role="status" className="text-sm text-accent">Suggestion reviewed.</p> : <div className="space-y-3"><p className="hint">Prepare a general business FAQ. The answer must directly answer the question and describe your confirmed policy. Remove private plans and customer-specific details.</p><label className="label" htmlFor={`${id}-faq-question`}>Public FAQ question</label><input id={`${id}-faq-question`} className="input" aria-label="Review question" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} /><label className="label" htmlFor={`${id}-faq-answer`}>Public answer</label><AutoGrowTextarea id={`${id}-faq-answer`} className="input" aria-label="Review answer" minRows={2} maxRows={6} maxLength={1000} value={answer} onChange={(e) => setAnswer(e.target.value)} /><div className="flex gap-2"><button type="button" className="btn-primary" disabled={pending || !question.trim() || !answer.trim()} onClick={() => review(true)}>Approve &amp; publish</button><button type="button" className="btn-ghost" disabled={pending} onClick={() => review(false)}>Decline suggestion</button></div>{error && <p role="alert" className="text-sm text-danger">{error}</p>}</div>;
}
