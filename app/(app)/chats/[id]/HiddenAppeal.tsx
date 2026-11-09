"use client";

import { useState, useTransition } from "react";
import { appealHiddenMessageAction } from "../../social-actions";

/** Under your own message that the community's agent hid after reports: appeal once, then see where it stands. */
export function HiddenAppeal({ messageId, conversationId, status }: { messageId: string; conversationId: string; status?: string }) {
  const [sent, setSent] = useState(status === "pending");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (status === "rejected") return <p className="mt-1 text-xs text-muted">Your appeal wasn&apos;t accepted.</p>;
  if (sent) return <p className="mt-1 text-xs text-muted" data-testid="hidden-appeal-sent">Appeal sent. A moderator can restore it; if nobody answers within 3 days and you have a good history here, it&apos;s restored automatically.</p>;
  return (
    <p className="mt-1 text-xs text-muted" data-testid="hidden-appeal">
      Think this is a mistake?{" "}
      <button
        type="button"
        className="font-medium text-accent hover:underline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await appealHiddenMessageAction(messageId, conversationId);
            if (r.error) setError(r.error);
            else setSent(true);
          })
        }
      >
        Appeal
      </button>
      {error && <span className="ml-2 text-danger">{error}</span>}
    </p>
  );
}
