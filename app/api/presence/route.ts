import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PresenceOwn, PresencePeer } from "@/lib/presence/types";

export async function GET(request: NextRequest) {
  if (!await getUser()) return NextResponse.json({}, { status: 401 });
  const parsed = z.array(z.uuid()).max(100).safeParse(request.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean) ?? []);
  if (!parsed.success) return NextResponse.json({}, { status: 400 });
  const db = await createClient();
  const [self, peers] = await Promise.all([db.rpc("presence_self", {}), db.rpc("presence_channels", { p_ids: parsed.data })]);
  const own = PresenceOwn.safeParse(self.data); const allowed = PresencePeer.array().safeParse(peers.data);
  if (self.error || peers.error) return NextResponse.json({}, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!own.success || !allowed.success) return NextResponse.json({}, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ own: own.data, peers: allowed.data }, { headers: { "Cache-Control": "private, no-store" } });
}
