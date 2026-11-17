import { z } from "zod";
import { requireAgent } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WorkNoticeActions } from "./WorkNoticeActions";
import { LocalTime } from "@/components/LocalTime";

const Notice = z.object({ id: z.uuid(), kind: z.enum(["information", "transfer_request"]), text: z.string(), created_at: z.string(), transfer_id: z.uuid().nullable(), staff_name: z.string().nullable(), from_name: z.string().nullable(), to_name: z.string().nullable(), requester_name: z.string().nullable(), expires_at: z.string().nullable() });
export async function BusinessWorkInbox() {
  const { agent } = await requireAgent(); if (agent.type !== "business") return null;
  const result = await (await createClient()).rpc("business_work_inbox"); const parsed = Notice.array().safeParse(result.data);
  if (result.error || !parsed.success) return <p role="alert" className="text-sm text-muted">Work updates could not be loaded. Refresh to try again.</p>;
  if (!parsed.data.length) return null;
  return <section aria-label="Your business work updates" data-testid="business-work-inbox" className="mb-4 space-y-3 rounded-2xl border border-accent/50 bg-accent-soft/30 p-4"><h2 className="font-semibold">Work updates <span className="text-sm text-muted">{parsed.data.length}</span></h2><ul className="space-y-3">{parsed.data.map((notice) => <li key={notice.id} data-testid={notice.kind === "transfer_request" ? "staff-transfer-request" : "business-work-notice"} className="rounded-xl border border-border bg-surface p-4"><p className="text-sm font-medium">{notice.kind === "transfer_request" ? `Accept ${notice.staff_name} into your team?` : notice.text}</p>{notice.kind === "transfer_request" && <><p className="mt-1 text-sm text-muted">Requested by {notice.requester_name}. Currently reports to {notice.from_name}. The reporting line changes only when you accept.</p>{notice.expires_at && <p className="hint mt-1">Expires <LocalTime iso={notice.expires_at} /></p>}</>}<p className="hint mt-2"><LocalTime iso={notice.created_at} /></p><WorkNoticeActions id={notice.id} transferId={notice.kind === "transfer_request" ? notice.transfer_id : null} /></li>)}</ul></section>;
}
