import "../lib/env.js"; // load .env before anything reads it
import { closeExpiredBidWindows } from "../bids/close.js";
import { log } from "../lib/logger.js";

// Standalone worker: closes elapsed bidding windows every 30 seconds.
// Run with `npm run worker`. In production you'd run one instance (or add a
// DB-level claim if you run several); the overlap guard below keeps a slow
// sweep from stacking on top of itself within a single instance.

const INTERVAL_MS = 30_000;
let running = false;

async function tick() {
  if (running) {
    log.warn("bidwindow.tick_skipped_overlap");
    return;
  }
  running = true;
  try {
    const results = await closeExpiredBidWindows();
    if (results.length > 0) {
      log.info("bidwindow.swept", { processed: results.length });
    }
  } catch (err) {
    log.error("bidwindow.sweep_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    running = false;
  }
}

log.info("bidwindow.worker_started", { intervalMs: INTERVAL_MS });
void tick(); // run once immediately, then on the interval
setInterval(tick, INTERVAL_MS);
