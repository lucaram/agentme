import "server-only";
import { recoverStuckTasks } from "@/lib/plans/engine";
import { pruneRateLimits } from "@/lib/limits";
import { pruneContactLists } from "@/lib/people/imports";
import { refreshDueSources } from "@/lib/business/sources";
import { autoResolveAppeals } from "@/lib/social/appeals";
import { nudgeInactiveModerators, sendDigests } from "@/lib/social/digest";

const SWEEP_EVERY_MS = 30_000;
const PRUNE_EVERY_MS = 15 * 60_000;

declare global {
  var __agentmeSweeper: ReturnType<typeof setInterval> | undefined;
}

/**
 * Background maintenance for a long-running Node server (`next dev` / `next start`):
 * resumes coordination tasks whose worker died, and prunes old rate-limit windows
 * unfinished contact lists, and re-reads business links older than a day.
 * Safe with several instances: task claims are atomic in Postgres.
 * (On serverless hosting, call the same functions from a scheduled cron route instead.)
 */
export function startSweeper() {
  if (globalThis.__agentmeSweeper) return;
  let lastPrune = 0;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const resumed = await recoverStuckTasks();
      if (resumed) console.log(`[agentme] resumed ${resumed} interrupted task(s)`);
      if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
        lastPrune = Date.now();
        await pruneRateLimits();
        await pruneContactLists();
        await refreshDueSources();
        // Communities: appeals nobody answered in 3 days, the daily digest, quiet moderators.
        await autoResolveAppeals();
        await sendDigests();
        await nudgeInactiveModerators();
      }
    } catch (error) {
      console.error("[agentme] sweeper error", error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };
  globalThis.__agentmeSweeper = setInterval(tick, SWEEP_EVERY_MS);
  // Run soon after boot so tasks interrupted by a restart resume quickly.
  setTimeout(tick, 5_000);
}
