import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MentionState } from "@/lib/chat/mentions";
import { z } from "zod";
async function state(claim: boolean, known: string[] = []) {
  await requireUser(); const { data, error } = await (await createClient()).rpc("mention_state", { p_claim: claim, p_known: known }); const parsed = MentionState.safeParse(data);
  return Response.json(error || !parsed.success ? { error: "Couldn't load mentions." } : parsed.data, { status: error || !parsed.success ? 503 : 200, headers: { "Cache-Control": "private, no-store" } });
}
export async function GET() { return state(false); }
export async function POST(request: Request) {
  const origin = request.headers.get("origin"); if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  const input = z.object({ known: z.array(z.uuid()).max(1000).default([]) }).safeParse(await request.json().catch(() => ({})));
  if (!input.success) return new Response(null, { status: 400 });
  return state(true, input.data.known);
}
