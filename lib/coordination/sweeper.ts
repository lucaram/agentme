import "server-only";
import { recoverStuckTasks } from "@/lib/plans/engine";
import { pruneRateLimits } from "@/lib/limits";
import { pruneContactLists } from "@/lib/people/imports";
import { refreshDueSources } from "@/lib/business/sources";
import { nudgeBusinessGaps, refreshDueSites } from "@/lib/business/website";
import { autoResolveAppeals } from "@/lib/social/appeals";
import { pruneResearchCache } from "@/lib/research";
import { pruneAnswerLog } from "@/lib/business/answer-log";
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
const MAINTENANCE: readonly (readonly [string, () => Promise<unknown>])[] = [
  ["rate limits", pruneRateLimits],
  ["contact lists", pruneContactLists],
  ["business links", () => refreshDueSources()],
  // Business websites: the daily re-read (tells the owner what changed), and the weekly "customers asked about…".
  ["business websites", () => refreshDueSites()],
  ["business gaps", nudgeBusinessGaps],
  ["research cache", pruneResearchCache],
  ["answer log", pruneAnswerLog],
  // Communities: appeals nobody answered in 3 days, the daily digest, quiet moderators.
  ["appeals", () => autoResolveAppeals()],
  ["digests", () => sendDigests()],
  ["quiet moderators", () => nudgeInactiveModerators()],
];

export function startSweeper() {
  if (globalThis.__agentmeSweeper) return;
  let lastPrune = 0;
  let running = false;
  let maintaining = false;
  /**
   * Housekeeping, on its own: it reads other people's websites, which can be slow, and must never hold up
   * the recovery of interrupted plans. Each job is separate too: one that fails doesn't stop the rest.
   */
  const maintain = async () => {
    if (maintaining) return;
    maintaining = true;
    try {
      for (const [name, job] of MAINTENANCE) {
        try {
          await job();
        } catch (error) {
          console.error(`[agentme] maintenance (${name}) failed`, error instanceof Error ? error.message : error);
        }
      }
    } finally {
      maintaining = false;
    }
  };
  const tick = async () => {
    if (Date.now() - lastPrune > PRUNE_EVERY_MS) {
      lastPrune = Date.now();
      void maintain();
    }
    if (running) return;
    running = true;
    try {
      const resumed = await recoverStuckTasks();
      if (resumed) console.log(`[agentme] resumed ${resumed} interrupted task(s)`);
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
