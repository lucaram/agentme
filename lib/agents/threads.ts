import "server-only";
import { z } from "zod";
import { adminClient } from "@/lib/supabase/admin";

/** "Find a plumber in Camden" → a short title until a plan names the thread. */
export function titleFromText(text: string): string {
  const line = text.replace(/^\s*@agent\b[\s,:]*/i, "").split("\n")[0].trim().replace(/\s+/g, " ");
  const short = line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
  return short ? short[0].toUpperCase() + short.slice(1) : "New request";
}

/**
 * The thread a message typed in My Agent belongs to: the one it was typed in
 * (if it's the owner's own request thread), otherwise a new one.
 */
export async function resolveThread(opts: { userId: string; conversationId: string; threadId?: string | null; text: string }): Promise<string> {
  const db = adminClient();
  if (opts.threadId && z.uuid().safeParse(opts.threadId).success) {
    const { data } = await db
      .from("agent_threads")
      .select("id")
      .eq("id", opts.threadId)
      .eq("owner_id", opts.userId)
      .eq("conversation_id", opts.conversationId)
      .eq("kind", "request")
      .maybeSingle();
    if (data) return data.id;
  }
  const { data, error } = await db
    .from("agent_threads")
    .insert({ owner_id: opts.userId, conversation_id: opts.conversationId, title: titleFromText(opts.text) })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("could not start a thread");
  return data.id;
}

export async function renameThread(userId: string, threadId: string, title: string): Promise<{ ok: boolean; error?: string }> {
  const clean = title.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!clean) return { ok: false, error: "Give it a name." };
  const { data } = await adminClient()
    .from("agent_threads")
    .update({ title: clean, renamed: true })
    .eq("id", threadId)
    .eq("owner_id", userId)
    .select("id");
  return data?.length ? { ok: true } : { ok: false, error: "Not found." };
}

export type ThreadGroup = "needs" | "progress" | "recent" | "older";
const WEEK = 7 * 86_400_000;

/** Where a thread sits in the list and what its status line says (from its latest plan). */
export function threadStatus(t: { kind: string; task_status: string | null; last_activity_at: string }, now: number): { group: ThreadGroup; label: string | null } {
  const recentOrOlder = (label: string | null) => ({ group: (now - Date.parse(t.last_activity_at) > WEEK ? "older" : "recent") as ThreadGroup, label });
  switch (t.task_status) {
    case "awaiting_approval":
      return { group: "needs", label: "Approve to start" };
    case "proposal_ready":
      return { group: "needs", label: "Plan ready: approve?" };
    case "running":
      return { group: "progress", label: "Working on it…" };
    case "waiting":
      return { group: "progress", label: "Waiting for answers" };
    case "accepted":
      return recentOrOlder("Plan shared ✓");
    case "completed":
      return recentOrOlder("Done ✓");
    case "cancelled":
      return recentOrOlder("Cancelled");
    case "rejected":
      return recentOrOlder("Not going ahead");
    case "failed":
      return recentOrOlder("Couldn't finish");
    default:
      return recentOrOlder(t.kind === "updates" ? "Notes and requests from others" : null);
  }
}
