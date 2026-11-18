"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { answerInboxAction, declineInboxAction } from "@/app/(app)/actions";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";

type Variant = "question" | "askAround" | "business";

const TEXT: Record<Variant, { label: string; send: string; decline: string; remember?: string; placeholder?: string }> = {
  question: { label: "Your answer", send: "Reply", decline: "Don't answer" },
  askAround: {
    label: "Your tip",
    send: "Share tip",
    decline: "I don't know",
    remember: "Also save as a tip, so my agent can share it next time someone asks",
    placeholder: "e.g. Joe's Plumbing, 020 7946 0000. Quick and fair.",
  },
  business: {
    label: "Your answer (sent as the team)",
    send: "Send answer",
    decline: "We don't know",
    remember: "Publish this as a public FAQ, so my agent can answer it next time",
  },
};

/** A contact's question, a friend asking around, or a visitor's question your business agent couldn't answer. */
export function QuestionForm({ itemId, variant = "question", faqEligible = false, staff = false, approvalRequired = true, disabled = false }: { itemId: string; variant?: Variant; faqEligible?: boolean; staff?: boolean; approvalRequired?: boolean; disabled?: boolean }) {
  const t = TEXT[variant];
  const [answer, setAnswer] = useState("");
  const [remember, setRemember] = useState(variant !== "business");
  const canRemember = Boolean(t.remember) && (variant !== "business" || faqEligible);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      try { const result = await fn(); if (result.error) setError(result.error); }
      catch { setError("Couldn't send your answer. Please try again."); }
    });

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => answerInboxAction(itemId, { answer }, canRemember && remember));
      }}
    >
      <label className="label" htmlFor={`${itemId}-answer`}>{t.label}</label>
      <AutoGrowTextarea
        disabled={disabled || pending}
        id={`${itemId}-answer`}
        className="input"
        minRows={2}
        maxRows={8}
        maxLength={1000}
        required
        placeholder={t.placeholder}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
      />
      {canRemember && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {staff && variant === "business" ? approvalRequired ? "Suggest this as a reusable answer for approval" : "Add this to Questions & Answers" : t.remember}
        </label>
      )}
      {variant === "business" && !faqEligible && <p className="hint">This answer stays private to this question and can&apos;t be added to your <Link href="/business#questions-answers" className="text-accent underline">Questions &amp; Answers</Link></p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending || disabled}>{pending ? "Sending…" : t.send}</button>
        <button type="button" className="btn-ghost" disabled={pending || disabled} onClick={() => run(() => declineInboxAction(itemId))}>
          {t.decline}
        </button>
      </div>
    </form>
  );
}
