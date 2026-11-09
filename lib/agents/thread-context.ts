import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which My Agent thread the owner is typing in. Everything the agent posts into
 * that My Agent while handling the message lands in the same thread (the
 * database files plan messages by their plan, and the rest into "From your
 * agent", so nothing is ever left out).
 */
type ThreadContext = { conversationId: string; threadId: string };
const storage = new AsyncLocalStorage<ThreadContext>();

export function withThread<T>(ctx: ThreadContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The thread for a message posted into this conversation, if the owner is typing in one. */
export function threadFor(conversationId: string): string | null {
  const ctx = storage.getStore();
  return ctx && ctx.conversationId === conversationId ? ctx.threadId : null;
}
