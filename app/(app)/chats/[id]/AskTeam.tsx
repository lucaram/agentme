"use client";

import { useState, useTransition } from "react";
import { askTeamAction } from "../../actions";

export function AskTeam({ messageId, sent }: { messageId: string; sent: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; notice?: string }>({});
  if (sent || result.notice) return <p role="status" className="hint mt-2">{result.notice ?? "Sent to the team. They'll reply privately to your original request."}</p>;
  return <div className="mt-2">
    <button className="btn-primary" disabled={pending} onClick={() => start(async () => setResult(await askTeamAction(messageId)))}>{pending ? "Sending…" : "Ask the team"}</button>
    {result.error && <p role="alert" className="hint text-danger">{result.error}</p>}
  </div>;
}
