import type { Bid, Job } from "@prisma/client";
import { prisma } from "../db.js";
import { sendSms as realSendSms } from "../lib/sms.js";
import { log } from "../lib/logger.js";
import { formatUsd } from "../lib/money.js";
import { rankBids, TOP_N } from "./rank.js";

interface ClosePrisma {
  job: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args?: any): Promise<Job[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(args: any): Promise<Job>;
  };
  bid: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args?: any): Promise<Bid[]>;
  };
}

export interface CloseDeps {
  prisma: ClosePrisma;
  sendSms: (to: string, body: string) => Promise<void>;
  now: () => number;
}

const defaultDeps: CloseDeps = {
  prisma: prisma as unknown as ClosePrisma,
  sendSms: realSendSms,
  now: () => Date.now(),
};

export interface CloseResult {
  jobId: string;
  outcome: "quoted" | "no_bids" | "error";
  optionCount?: number;
}

// Numbered 1/2/3 options for the homeowner to reply to.
function homeownerOptionsSms(top: Bid[]): string {
  const lines = top.map(
    (b, i) =>
      `${i + 1}) ${formatUsd(b.priceCents)} — arrives in ~${b.etaMinutes} min`,
  );
  return (
    `Your plumbing quotes are in. Reply with a number to book:\n` +
    lines.join("\n")
  );
}

// Find standard jobs whose bidding window has elapsed and that are still open,
// rank their bids, and text the homeowner the top options. Meant to be called
// on a schedule (every 30s) by the bid-window worker. Never throws — a failure
// on one job is logged and the sweep continues.
export async function closeExpiredBidWindows(
  deps: CloseDeps = defaultDeps,
): Promise<CloseResult[]> {
  const now = new Date(deps.now());
  const jobs = await deps.prisma.job.findMany({
    where: { status: "bidding", biddingExpiresAt: { lte: now } },
  });

  const results: CloseResult[] = [];

  for (const job of jobs) {
    try {
      const bids = await deps.prisma.bid.findMany({
        where: { jobId: job.id, status: "submitted" },
      });

      if (bids.length === 0) {
        // Window elapsed with no bids. Close the job out rather than leaving it
        // to be swept forever, and let the homeowner know.
        await deps.prisma.job.update({
          where: { id: job.id },
          data: { status: "cancelled" },
        });
        await deps.sendSms(
          job.homeownerPhone,
          "No plumbers bid on your job within the window. We'll follow up shortly to help.",
        );
        log.warn("bidwindow.no_bids", { jobId: job.id });
        results.push({ jobId: job.id, outcome: "no_bids" });
        continue;
      }

      const top = rankBids(bids).slice(0, TOP_N);

      // Send options first, then flip status — so a send failure leaves the job
      // in 'bidding' to be retried on the next sweep, rather than 'quoted' with
      // the homeowner never having received the options.
      await deps.sendSms(job.homeownerPhone, homeownerOptionsSms(top));
      await deps.prisma.job.update({
        where: { id: job.id },
        data: { status: "quoted" },
      });

      log.info("bidwindow.quoted", { jobId: job.id, optionCount: top.length });
      results.push({ jobId: job.id, outcome: "quoted", optionCount: top.length });
    } catch (err) {
      log.error("bidwindow.job_failed", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
      results.push({ jobId: job.id, outcome: "error" });
    }
  }

  return results;
}
