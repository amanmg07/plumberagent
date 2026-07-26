import type { Bid, Job, Provider } from "@prisma/client";
import { prisma } from "../db.js";
import { sendSms as realSendSms } from "../lib/sms.js";
import { log } from "../lib/logger.js";
import { formatUsd } from "../lib/money.js";
import { rankBids, TOP_N } from "./rank.js";

// Transaction client view — the subset of methods used inside $transaction.
interface AcceptTx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: { updateMany(args: any): Promise<{ count: number }> };
  bid: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(args: any): Promise<Bid>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany(args: any): Promise<{ count: number }>;
  };
}

interface AcceptPrisma {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: { findMany(args?: any): Promise<Job[]> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bid: { findMany(args?: any): Promise<Bid[]> };
  provider: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique(args: any): Promise<Provider | null>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args?: any): Promise<Provider[]>;
  };
  $transaction<T>(fn: (tx: AcceptTx) => Promise<T>): Promise<T>;
}

export interface AcceptDeps {
  prisma: AcceptPrisma;
  sendSms: (to: string, body: string) => Promise<void>;
}

const defaultDeps: AcceptDeps = {
  prisma: prisma as unknown as AcceptPrisma,
  sendSms: realSendSms,
};

export interface AcceptResult {
  accepted: boolean;
  reason?:
    | "invalid_selection"
    | "no_quoted_job"
    | "selection_out_of_range"
    | "already_accepted";
  jobId?: string;
  bidId?: string;
  providerId?: string;
}

// Pull the picked option number out of an SMS reply ("2", "option 2", "2 pls").
// Returns the first 1-9 digit found, or null.
function parseSelection(reply: string): number | null {
  const m = reply.match(/[1-9]/);
  return m ? Number.parseInt(m[0], 10) : null;
}

function winnerSms(job: Job): string {
  return (
    `You're booked! Head to the job.\n` +
    `Address: ${job.address}\n` +
    `Homeowner: ${job.homeownerPhone}`
  );
}

function homeownerConfirmSms(bid: Bid): string {
  return (
    `You're booked! ${formatUsd(bid.priceCents)}, arriving in ~${bid.etaMinutes} min. ` +
    `Your plumber will be in touch.`
  );
}

function loserSms(): string {
  return `Thanks for bidding — the homeowner picked another plumber this time.`;
}

// Handle a homeowner replying "1"/"2"/"3" to their quotes. In one transaction:
// mark the picked bid accepted, reject the rest, flip the job to 'accepted',
// and assign the winning provider. Then reveal the address to the winner.
//
// Wire this to the inbound-SMS webhook: route texts from a homeowner whose job
// is in 'quoted' status here. Never throws.
export async function handleHomeownerSelection(
  homeownerPhone: string,
  reply: string,
  deps: AcceptDeps = defaultDeps,
): Promise<AcceptResult> {
  const selection = parseSelection(reply);
  if (selection === null) {
    log.info("accept.invalid_selection", { homeownerPhone, reply });
    await deps.sendSms(
      homeownerPhone,
      `Sorry, please reply with a number (1-${TOP_N}) to pick a plumber.`,
    );
    return { accepted: false, reason: "invalid_selection" };
  }

  // Most recent quoted job for this homeowner.
  const quoted = await deps.prisma.job.findMany({
    where: { status: "quoted", homeownerPhone },
  });
  const job = quoted.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];
  if (!job) {
    log.info("accept.no_quoted_job", { homeownerPhone });
    return { accepted: false, reason: "no_quoted_job" };
  }

  // Rank the same bids that were quoted; option N is index N-1.
  const bids = await deps.prisma.bid.findMany({
    where: { jobId: job.id, status: "submitted" },
  });
  const top = rankBids(bids).slice(0, TOP_N);
  const index = selection - 1;
  if (index >= top.length) {
    log.info("accept.selection_out_of_range", {
      jobId: job.id,
      selection,
      available: top.length,
    });
    await deps.sendSms(
      homeownerPhone,
      `That option isn't available. Please reply 1-${top.length}.`,
    );
    return { accepted: false, reason: "selection_out_of_range", jobId: job.id };
  }
  const chosen = top[index];

  // One transaction: claim the job (status-guarded so a double-reply can't
  // double-book), accept the chosen bid, reject the rest.
  const outcome = await deps.prisma.$transaction(async (tx) => {
    const claim = await tx.job.updateMany({
      where: { id: job.id, status: "quoted" },
      data: { status: "accepted", assignedProviderId: chosen.providerId },
    });
    if (claim.count === 0) return { raced: true as const };

    await tx.bid.update({
      where: { id: chosen.id },
      data: { status: "accepted" },
    });
    await tx.bid.updateMany({
      where: { jobId: job.id, id: { not: chosen.id } },
      data: { status: "rejected" },
    });
    return { raced: false as const };
  });

  if (outcome.raced) {
    log.info("accept.already_accepted", { jobId: job.id });
    return { accepted: false, reason: "already_accepted", jobId: job.id };
  }

  // Reveal the address to the winning provider (the required side effect).
  const winner = await deps.prisma.provider.findUnique({
    where: { id: chosen.providerId },
  });
  if (winner) {
    await deps.sendSms(winner.phone, winnerSms(job));
  } else {
    log.error("accept.winner_provider_missing", { providerId: chosen.providerId });
  }

  // Confirm to the homeowner and let the losing bidders know.
  await deps.sendSms(job.homeownerPhone, homeownerConfirmSms(chosen));

  const loserIds = bids
    .filter((b) => b.id !== chosen.id)
    .map((b) => b.providerId);
  if (loserIds.length > 0) {
    const losers = await deps.prisma.provider.findMany({
      where: { id: { in: loserIds } },
    });
    await Promise.all(losers.map((p) => deps.sendSms(p.phone, loserSms())));
  }

  log.info("accept.booked", {
    jobId: job.id,
    bidId: chosen.id,
    providerId: chosen.providerId,
  });
  return {
    accepted: true,
    jobId: job.id,
    bidId: chosen.id,
    providerId: chosen.providerId,
  };
}
