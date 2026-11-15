import { z } from "zod";
import { getUser, requireAgent } from "@/lib/auth";
import { chatWriteAccess } from "@/lib/chat/access";
import { pollPeople } from "@/lib/chat/send-rich";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { user, agent } = await requireAgent(); const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  try {
    const conv = await chatWriteAccess(id, user.id, agent.id);
    return Response.json({ choosePeople: conv.kind === "my_agent", people: (await pollPeople(conv, agent)).filter((p) => p.id !== agent.id).map((p) => ({ id: p.id, name: p.display_name, handle: p.handle })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Not found." }, { status: 400 }); }
}
