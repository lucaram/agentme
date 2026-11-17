import { getUser } from "@/lib/auth";
import { getAgentForUser } from "@/lib/data/agents";
import { identityNotificationState } from "@/lib/identities";
import { sessionRestriction } from "@/lib/moderation/session";

export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getUser(); if (!user) return Response.json({}, { status: 401, headers });
  if (await sessionRestriction(user.id)) return Response.json({}, { status: 403, headers });
  const agent = await getAgentForUser(user.id); if (!agent) return Response.json({}, { status: 403, headers });
  try { return Response.json(await identityNotificationState(user, agent), { headers }); }
  catch { return Response.json({ error: "Notifications temporarily unavailable." }, { status: 503, headers }); }
}
