import { agentCardResponse } from "@/lib/a2a/server";

/** A2A Agent Card: GET /api/a2a/{handle}/.well-known/agent-card.json */
export async function GET(_request: Request, ctx: RouteContext<"/api/a2a/[handle]/.well-known/agent-card.json">) {
  const { handle } = await ctx.params;
  return agentCardResponse(handle.toLowerCase());
}
