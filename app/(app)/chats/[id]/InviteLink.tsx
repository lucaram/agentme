"use client";

import { useState, useTransition } from "react";
import { inviteLinkAction, revokeInviteAction } from "../../people-actions";
import { ShareLink } from "../../contacts/ShareLink";

/**
 * Organiser: a link for people who aren't on AGENTME (or aren't contacts yet).
 * They can answer as a guest in seconds. Shared from the organiser's own phone,
 * so AGENTME never stores anyone's number or email.
 */
export function InviteLink({ taskId, title }: { taskId: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!url) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await inviteLinkAction(taskId);
              if (result.error) setError(result.error);
              else setUrl(result.url ?? null);
            })
          }
        >
          {pending ? "…" : "🔗 Invite by link"}
        </button>
        {error && <span className="text-xs text-danger" role="alert">{error}</span>}
      </div>
    );
  }
  return (
    <div className="card w-full space-y-2" data-testid="invite-link">
      <p className="text-sm">
        Anyone with this link can join <b>{title}</b>, even without AGENTME (as a guest). It works for 14 days.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-accent-soft px-2 py-1.5 text-xs" data-testid="invite-url">{url}</code>
        <ShareLink url={url} text={`Join “${title}” on AGENTME`} label="Share link" />
      </div>
      <div className="flex gap-3 text-xs">
        <button type="button" className="text-muted underline" onClick={() => setUrl(null)}>Hide</button>
        <button
          type="button"
          className="text-danger underline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await revokeInviteAction(taskId);
              setUrl(null);
              setError("Link turned off. Make a new one any time.");
            })
          }
        >
          Turn off link
        </button>
      </div>
    </div>
  );
}
