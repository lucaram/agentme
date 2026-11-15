"use client";

import { useState, useTransition } from "react";
import { removeMessageAction } from "../../social-actions";
import { ClosableDetails } from "@/components/ClosableDetails";
import { ForwardPicker } from "./Forward";
import { replyTo } from "@/lib/client/reply";
import type { ReplyTarget } from "@/lib/social/quote";
import { DeleteMessageDialog } from "@/components/chat/DeleteMessageDialog";
import { ChatDialog } from "@/components/chat/ChatDialog";
import { ReportEditor } from "@/components/moderation/SpaceReportForm";

/** Own human messages can be deleted; reporting and moderator removal remain separate actions. */
export function MessageActions({
  messageId,
  conversationId,
  canReport,
  localReportDestination,
  canRemove,
  canDelete = false,
  privateMessage = false,
  canForward = false,
  reply,
}: {
  messageId: string;
  conversationId: string;
  canReport: boolean;
  localReportDestination?: "group" | "community";
  canRemove: boolean;
  canDelete?: boolean;
  privateMessage?: boolean;
  canForward?: boolean;
  /** ↩ Reply: quote this message in the message box. */
  reply?: ReplyTarget;
}) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [menu, setMenu] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  if (!canReport && !canRemove && !canDelete && !canForward && !reply) return null;
  return (
    <>
      {reporting && <ChatDialog label="Report message" onClose={() => setReporting(false)}><ReportEditor kind="message" target={messageId} localDestination={localReportDestination} onClose={() => setReporting(false)} /></ChatDialog>}
      {deleting && <DeleteMessageDialog messageId={messageId} privateMessage={privateMessage} onClose={() => setDeleting(false)} />}
      {canDelete && <button type="button" className="hover-only rounded-full px-1.5 py-0.5 text-sm text-muted hover:bg-accent-soft hover:text-danger" aria-label="Delete" title="Delete" onClick={() => setDeleting(true)}>
        <svg aria-hidden viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></svg>
      </button>}
      {forwarding && (
        <ForwardPicker
          messageId={messageId}
          onClose={() => setForwarding(false)}
        />
      )}
      <ClosableDetails className="relative" onToggle={(event) => {
        const details = event.currentTarget; if (!details.open) { setMenu(null); return; }
        const anchor = details.querySelector("summary")!.getBoundingClientRect();
        const popup = details.querySelector<HTMLElement>("[data-message-menu]")!; const rect = popup.getBoundingClientRect();
        const view = window.visualViewport; const top = view?.offsetTop ?? 0; const height = view?.height ?? window.innerHeight;
        const width = view?.width ?? window.innerWidth; const popupHeight = Math.min(rect.height, height - 16);
        setMenu({ left: Math.max(8, Math.min(anchor.left, width - rect.width - 8)), top: Math.max(top + 8, Math.min(anchor.bottom + 4 + popupHeight <= top + height ? anchor.bottom + 4 : anchor.top - popupHeight - 4, top + height - popupHeight - 8)), maxHeight: height - 16 });
      }}>
        <summary
          className="cursor-pointer list-none px-1 text-xs text-muted hover:text-foreground"
          aria-label="Message options"
        >
          ⋯
        </summary>
        <div className="fixed z-50 flex min-w-36 flex-col overflow-y-auto rounded-xl border border-border bg-surface p-1 text-sm shadow-lg" data-message-menu="" style={{ ...menu, visibility: menu ? "visible" : "hidden" }}>
          {reply && (
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-left hover:bg-accent-soft"
            onClick={(e) => {
              e.currentTarget.closest("details")?.removeAttribute("open");
              replyTo(conversationId, reply);
            }}
          >
            ↩ Reply
          </button>
        )}
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
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open"); setReporting(true);
              }}
            >
              🚩 Report
            </button>
          )}
          {canDelete && <button type="button" className="rounded-lg px-2 py-1 text-left text-danger hover:bg-accent-soft" onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); setDeleting(true); }}>Delete</button>}
          {canRemove && !canDelete && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 text-left text-danger hover:bg-accent-soft"
              disabled={pending}
              onClick={() => {
                if (!window.confirm("Remove this message as a moderator?"))
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
              🗑️ Remove
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
