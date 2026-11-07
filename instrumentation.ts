/** Runs once per server start. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.AGENTME_DISABLE_SWEEPER !== "1") {
    const { startSweeper } = await import("./lib/coordination/sweeper");
    startSweeper();
  }
}
