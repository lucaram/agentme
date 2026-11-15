"use client";

import { useState, useTransition } from "react";
import { deleteOwnMessageAction } from "@/app/(app)/delete-message-action";
import { clearReplyTo } from "@/lib/client/reply";
import { ChatDialog } from "./ChatDialog";

export function DeleteMessageDialog({ messageId, privateMessage, onClose }: { messageId: string; privateMessage: boolean; onClose: () => void }) {
  const [pending, start] = useTransition(); const [error, setError] = useState("");
  return <ChatDialog label="Delete message" onClose={() => { if (!pending) onClose(); }}><section className="space-y-4 p-5">
    <h2 className="font-semibold">{privateMessage ? "Delete this private message?" : "Delete this message for everyone?"}</h2>
    <p className="text-sm text-muted">This cannot be undone. Plans, polls and requests already created will stay active.</p>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-ghost" disabled={pending} onClick={onClose}>Cancel</button>
      <button type="button" className="btn-ghost border-danger text-danger" disabled={pending} onClick={() => start(async () => {
        setError("");
        try {
          const result = await deleteOwnMessageAction(messageId);
          if (result.error) setError(result.error);
          else { clearReplyTo([messageId]); onClose(); }
        } catch { setError("Couldn't delete the message. Please try again."); }
      })}>{pending ? "Deleting…" : privateMessage ? "Delete" : "Delete for everyone"}</button>
    </div>
  </section></ChatDialog>;
}
