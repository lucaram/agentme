import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionUser } from "@/lib/auth";
import type { AgentRow } from "@/lib/data/agents";

type Actor = { id: string; business: string; owner: string };
const actors = new AsyncLocalStorage<Actor>();
export const currentBusinessActor = () => actors.getStore();
export function withBusinessActor<T>(user: SessionUser, agent: AgentRow, work: () => Promise<T>) {
  return agent.type === "business" ? actors.run({ id: user.actorId ?? user.id, business: agent.id, owner: agent.owner_id }, work) : work();
}
