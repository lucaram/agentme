"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { answerGapAction, dismissGapAction } from "./website-actions";

export type GapView = { key: string; title: string; questions: string[]; ids: string[] };

/**
 * "Questions your website doesn't answer": answer once, everyone who asked
 * gets it, and the agent knows it from now on. Always rendered (empty when
 * there's nothing), so a "✓ Sent" stays on screen after the page refreshes.
 */
export function GapsSection({ gaps }: { gaps: GapView[] }) {
  const [done, setDone] = useState<{ key: string; text: string }[]>([]);
  const open = gaps.filter((g) => !done.some((d) => d.key === g.key));
  if (!open.length && !done.length) return null;
  return (
    <section id="gaps" className="card scroll-mt-40 space-y-3 border-accent" aria-label="Questions your website doesn't answer" data-testid="gaps">
      <div>
        <h2 className="font-semibold">Questions your website doesn&apos;t answer</h2>
        <p className="hint">Customers asked these and your agent didn&apos;t know. Answer once: everyone who asked gets it, and your agent answers it by itself from now on.</p>
      </div>
      <ul className="space-y-3">
        {done.map((d) => (
          <li key={d.key} className="rounded-xl bg-accent-soft px-3 py-2 text-sm" role="status" data-testid="gap-done">
            {d.text}
          </li>
        ))}
        {open.map((g) => (
          <Gap key={g.key} gap={g} onDone={(text) => setDone((list) => [...list, { key: g.key, text }])} />
        ))}
      </ul>
    </section>
  );
}

function Gap({ gap, onDone }: { gap: GapView; onDone: (text: string) => void }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const people = gap.ids.length;
  return (
    <li className="space-y-2 rounded-xl border border-border p-3" data-testid="gap">
      <p className="text-sm font-medium">❓ {gap.title}</p>
      {people > 1 && (
        <ul className="space-y-1 text-xs text-muted">
          {gap.questions.slice(0, 3).map((q, i) => (
            <li key={`${i}-${q}`}>“{q}”</li>
          ))}
          {people > 3 && <li>and {people - 3} more</li>}
        </ul>
      )}
      <AutoGrowTextarea
        className="input"
        minRows={2}
        maxRows={6}
        maxLength={1000}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Your answer, e.g. Yes: free parking behind the shop, 20 spaces."
        aria-label={`Answer: ${gap.title}`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !answer.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await answerGapAction(gap.ids, gap.questions[0], answer);
              if (r.error) return setError(r.error);
              onDone(`✓ Sent to ${r.sent === 1 ? "the customer who asked" : `all ${r.sent} customers who asked`}. Your agent knows it from now on (it's in your Questions & answers).`);
              router.refresh();
            })
          }
        >
          {pending ? "Sending…" : people === 1 ? "Send and remember" : `Send to all ${people} and remember`}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await dismissGapAction(gap.ids);
              if (r.error) return setError(r.error);
              onDone(`OK: ${people === 1 ? "they've" : "everyone who asked has"} been told the team couldn't answer.`);
              router.refresh();
            })
          }
        >
          We can&apos;t answer this
        </button>
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    </li>
  );
}
