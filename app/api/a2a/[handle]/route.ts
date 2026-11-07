import { handleA2ARequest } from "@/lib/a2a/server";

/** A2A JSON-RPC endpoint for one agent: POST /api/a2a/{handle} */
export async function POST(request: Request, ctx: RouteContext<"/api/a2a/[handle]">) {
  const { handle } = await ctx.params;
  return handleA2ARequest(request, handle.toLowerCase());
}
