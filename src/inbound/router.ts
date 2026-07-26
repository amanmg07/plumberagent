import type { Bid, Job, Provider } from "@prisma/client";
import { prisma } from "../db.js";
import { sendSms as realSendSms } from "../lib/sms.js";
import { log } from "../lib/logger.js";
import { formatUsd } from "../lib/money.js";
import { parseBid as realParseBid, type ParsedBid } from "../bids/parse.js";
import {
  handleEmergencyAccept as realHandleEmergencyAccept,
  type EmergencyAcceptResult,
} from "../dispatch/dispatch.js";
import {
  handleHomeownerSelection as realHandleHomeownerSelection,
  type AcceptResult,
} from "../bids/accept.js";

// The one inbound-SMS entry point. Every provider/homeowner text reply lands
// here and is routed by (a) who sent it and (b) the state of their job.

interface RouterPrisma {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: { findFirst(args: any): Promise<Provider | null> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: { findMany(args?: any): Promise<Job[]> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bid: { upsert(args: any): Promise<Bid> };
}

export interface InboundDeps {
  prisma: RouterPrisma;
  sendSms: (to: string, body: string) => Promise<void>;
  parseBid: (raw: string) => Promise<ParsedBid | null>;
  handleEmergencyAccept: (phone: string) => Promise<EmergencyAcceptResult>;
  handleHomeownerSelection: (phone: string, body: string) => Promise<AcceptResult>;
}

const defaultDeps: InboundDeps = {
  prisma: prisma as unknown as RouterPrisma,
  sendSms: realSendSms,
  parseBid: (raw) => realParseBid(raw),
  handleEmergencyAccept: (phone) => realHandleEmergencyAccept(phone),
  handleHomeownerSelection: (phone, body) => realHandleHomeownerSelection(phone, body),
};

export type InboundOutcome =
  | { kind: "emergency_accept"; jobId?: string; result: EmergencyAcceptResult }
  | { kind: "emergency_ignored"; jobId: string }
  | { kind: "bid_recorded"; jobId: string }
  | { kind: "bid_unparseable"; jobId: string }
  | { kind: "no_active_job_for_provider"; providerId: string }
  | { kind: "homeowner_selection"; result: AcceptResult }
  | { kind: "unmatched" };

// Treat these as an emergency acceptance.
function isAffirmative(body: string): boolean {
  const t = body.trim().toLowerCase();
  return /^(y|yes|yea|yeah|yep|yup|sure|ok|okay|accept|accepted|take it|i'?ll take it|got it|on my way|omw)\b/.test(
    t,
  );
}

export async function routeInboundSms(
  from: string,
  body: string,
  deps: InboundDeps = defaultDeps,
): Promise<InboundOutcome> {
  const provider = await deps.prisma.provider.findFirst({ where: { phone: from } });

  if (provider) {
    // Find this provider's active job (they were contacted for it this round).
    const jobs = await deps.prisma.job.findMany({
      where: { status: { in: ["dispatched", "bidding"] } },
    });
    const active = jobs
      .filter((j) => j.dispatchedProviderIds.includes(provider.id))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (active && active.status === "dispatched") {
      // Emergency race: an affirmative reply accepts; anything else is a pass.
      if (isAffirmative(body)) {
        const result = await deps.handleEmergencyAccept(from);
        log.info("inbound.emergency_accept", { from, jobId: active.id, accepted: result.accepted });
        return { kind: "emergency_accept", jobId: active.id, result };
      }
      log.info("inbound.emergency_ignored", { from, jobId: active.id });
      return { kind: "emergency_ignored", jobId: active.id };
    }

    if (active && active.status === "bidding") {
      // Standard auction: parse the bid and record it (upsert — one per pair).
      const parsed = await deps.parseBid(body);
      if (!parsed) {
        await deps.sendSms(
          from,
          `Couldn't read that as a bid. Reply with a price and ETA, e.g. "$180, there by 3pm".`,
        );
        return { kind: "bid_unparseable", jobId: active.id };
      }
      await deps.prisma.bid.upsert({
        where: {
          one_bid_per_provider_per_job: { jobId: active.id, providerId: provider.id },
        },
        create: {
          jobId: active.id,
          providerId: provider.id,
          priceCents: parsed.priceCents,
          etaMinutes: parsed.etaMinutes,
          rawText: body,
          status: "submitted",
        },
        // Re-bidding updates the existing row rather than stacking.
        update: {
          priceCents: parsed.priceCents,
          etaMinutes: parsed.etaMinutes,
          rawText: body,
          status: "submitted",
        },
      });
      await deps.sendSms(
        from,
        `Bid received: ${formatUsd(parsed.priceCents)}, ~${parsed.etaMinutes} min. We'll text if the homeowner picks you.`,
      );
      log.info("inbound.bid_recorded", { from, jobId: active.id });
      return { kind: "bid_recorded", jobId: active.id };
    }

    log.info("inbound.no_active_job_for_provider", { providerId: provider.id });
    return { kind: "no_active_job_for_provider", providerId: provider.id };
  }

  // Not a provider — is this a homeowner picking from their quotes?
  const quoted = await deps.prisma.job.findMany({
    where: { status: "quoted", homeownerPhone: from },
  });
  if (quoted.length > 0) {
    const result = await deps.handleHomeownerSelection(from, body);
    log.info("inbound.homeowner_selection", { from, accepted: result.accepted });
    return { kind: "homeowner_selection", result };
  }

  log.warn("inbound.unmatched", { from });
  return { kind: "unmatched" };
}
