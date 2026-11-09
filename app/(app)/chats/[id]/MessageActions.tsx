"use client";

import { useState, useTransition } from "react";
import { removeMessageAction, reportMessageAction } from "../../social-actions";
import { ClosableDetails } from "@/components/ClosableDetails";
import { ForwardPicker } from "./Forward";

/** ⋯ on a message: forward it (you, never your agent), report it, or remove it (own message / admins / moderators). */
export function MessageActions({
  messageId,
  conversationId,
  canReport,
  canRemove,
  canForward = false,
}: {
  messageId: string;
  conversationId: string;
  canReport: boolean;
  canRemove: boolean;
  canForward?: boolean;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState(false);
  if (!canReport && !canRemove && !canForward) return null;
  return (
    <>
      {forwarding && (
        <ForwardPicker
          messageId={messageId}
          onClose={() => setForwarding(false)}
        />
      )}
      <ClosableDetails className="relative">
        <summary
          className="cursor-pointer list-none px-1 text-xs text-muted hover:text-foreground"
          aria-label="Message options"
        >
          ⋯
        </summary>
        <div className="absolute z-10 mt-1 flex min-w-36 flex-col rounded-xl border border-border bg-surface p-1 text-sm shadow">
          {canForward && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-left hover:bg-accent-soft"
              onClick={() => setForwarding(true)}
            >
              ↪ Forward
            </button>
          )}
          {canReport && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-left hover:bg-accent-soft"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt(
                  "Report this message: what's wrong? (spam, abuse, …)",
                );
                if (!reason?.trim()) return;
                start(async () => {
                  const result = await reportMessageAction(messageId, reason);
                  setNote(result.error ?? "Reported. Thanks!");
                });
              }}
            >
              🚩 Report
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-left text-danger hover:bg-accent-soft"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Remove this message for everyone?"))
                  return;
                start(async () => {
                  const result = await removeMessageAction(
                    messageId,
                    conversationId,
                  );
                  if (result.error) setNote(result.error);
                });
              }}
            >
              🗑️ Remove for everyone
            </button>
          )}
          {note && (
            <p className="px-2 py-1 text-xs text-muted" role="status">
              {note}
            </p>
          )}
        </div>
      </ClosableDetails>
    </>
  );
}
