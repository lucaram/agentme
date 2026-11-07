import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who an AI call is being made for. Set around a unit of work (a task run, a
 * reply to another agent, a chat turn); every model call inside it is
 * attributed without threading ids through every function.
 */
export type UsageContext = { taskId?: string | null; agentId?: string | null; userId?: string | null };

const storage = new AsyncLocalStorage<UsageContext>();

export function withUsageContext<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return storage.run({ ...storage.getStore(), ...ctx }, fn);
}

export function currentUsageContext(): UsageContext {
  return storage.getStore() ?? {};
}
