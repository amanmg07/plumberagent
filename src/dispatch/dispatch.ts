import type { Job, Provider } from "@prisma/client";
import { prisma } from "../db.js";
import { sendSms as realSendSms } from "../lib/sms.js";
import { log } from "../lib/logger.js";
import { findEligibleProviders } from "./match.js";

export const STANDARD_BID_WINDOW_MINUTES = 15;
export const STANDARD_FANOUT = 5; // open the auction to the 5 nearest
export const EMERGENCY_FANOUT = 3; // blast the 3 nearest, first "yes" wins

// Minimal structural view of the Prisma methods dispatch uses, so tests can
// pass a fake. The real client is cast to this in the default deps.
interface DispatchPrisma {
  provider: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args?: any): Promise<Provider[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findFirst(args?: any): Promise<Provider | null>;
  };
  job: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(args: any): Promise<Job>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany(args: any): Promise<{ count: number }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findMany(args?: any): Promise<Job[]>;
  };
}

export interface DispatchDeps {
  prisma: DispatchPrisma;
  sendSms: (to: string, body: string) => Promise<void>;
  now: () => number; // injectable clock for deterministic bidding_expires_at
}

const defaultDeps: DispatchDeps = {
  prisma: prisma as unknown as DispatchPrisma,
  sendSms: realSendSms,
  now: () => Date.now(),
};

// A job carries everything dispatch needs once triage has run.
export type DispatchableJob = Pick<
  Job,
  | "id"
  | "category"
  | "description"
  | "photoUrls"
  | "address"
  | "homeownerPhone"
  | "lat"
  | "lng"
  | "urgency"
  | "dispatchedProviderIds"
>;

export interface DispatchResult {
  path: "emergency" | "standard";
  contactedProviderIds: string[];
  biddingExpiresAt?: Date;
}

// ---- Message bodies (no address until a provider is committed) ----

function standardJobSms(job: DispatchableJob): string {
  const photos =
    job.photoUrls.length > 0 ? job.photoUrls.join(" ") : "no photos";
  return (
    `New ${job.category} job near you: ${job.description}\n` +
    `Photos: ${photos}\n` +
    `Reply with your price and ETA (e.g. "$180, there by 3pm") in the next ` +
    `${STANDARD_BID_WINDOW_MINUTES} min to bid. Address shared if you win.`
  );
}

function emergencyOfferSms(job: DispatchableJob): string {
  return (
    `URGENT ${job.category} job: ${job.description}\n` +
    `Reply YES to take it — first to accept gets it. Address shared on acceptance.`
  );
}

function emergencyWonSms(job: DispatchableJob): string {
  return (
    `You got the job! Head over now.\n` +
    `Address: ${job.address}\n` +
    `Homeowner: ${job.homeownerPhone}`
  );
}

function emergencyFilledSms(): string {
  return `That emergency job has been filled. Thanks for the fast response.`;
}

// ---- Dispatch paths ----

// Standard: open a 15-minute sealed-bid auction to the 5 nearest eligible
// providers. No bids exist yet — providers reply via SMS (parsed in step 5).
export async function dispatchStandard(
  job: DispatchableJob,
  deps: DispatchDeps = defaultDeps,
): Promise<DispatchResult> {
  const providers = await deps.prisma.provider.findMany({
    where: { isAvailable: true },
  });
  const matches = findEligibleProviders(job, providers, {
    requireVerified: false,
    limit: STANDARD_FANOUT,
  });

  if (matches.length === 0) {
    log.warn("dispatch.standard.no_providers", { jobId: job.id });
    return { path: "standard", contactedProviderIds: [] };
  }

  const biddingExpiresAt = new Date(
    deps.now() + STANDARD_BID_WINDOW_MINUTES * 60_000,
  );
  const contactedProviderIds = matches.map((m) => m.provider.id);

  // Record who we invited so an inbound bid SMS can be matched back to this job
  // (the provider's text doesn't reference a job id).
  await deps.prisma.job.update({
    where: { id: job.id },
    data: { status: "bidding", biddingExpiresAt, dispatchedProviderIds: contactedProviderIds },
  });

  await Promise.all(
    matches.map((m) => deps.sendSms(m.provider.phone, standardJobSms(job))),
  );
  log.info("dispatch.standard.opened", {
    jobId: job.id,
    contactedProviderIds,
    biddingExpiresAt,
  });
  return { path: "standard", contactedProviderIds, biddingExpiresAt };
}

// Emergency: blast the nearest few available, verified, in-range providers.
// First to reply "yes" wins (handleEmergencyAccept). No auction, no waiting.
export async function dispatchEmergency(
  job: DispatchableJob,
  deps: DispatchDeps = defaultDeps,
): Promise<DispatchResult> {
  const providers = await deps.prisma.provider.findMany({
    where: { isAvailable: true },
  });
  const matches = findEligibleProviders(job, providers, {
    requireVerified: true, // emergencies go to verified providers only
    limit: EMERGENCY_FANOUT,
  });

  if (matches.length === 0) {
    // No one to dispatch — this needs human escalation. Left as a loud log for
    // now; the job stays 'posted' rather than silently moving to 'dispatched'.
    log.error("dispatch.emergency.no_providers", { jobId: job.id });
    return { path: "emergency", contactedProviderIds: [] };
  }

  const contactedProviderIds = matches.map((m) => m.provider.id);

  await deps.prisma.job.update({
    where: { id: job.id },
    data: { status: "dispatched", dispatchedProviderIds: contactedProviderIds },
  });

  await Promise.all(
    matches.map((m) => deps.sendSms(m.provider.phone, emergencyOfferSms(job))),
  );

  log.info("dispatch.emergency.sent", { jobId: job.id, contactedProviderIds });
  return { path: "emergency", contactedProviderIds };
}

// Router — call this after triage. Routes on urgency. A null urgency shouldn't
// happen post-triage; if it does, fail safe to the emergency path.
export async function dispatch(
  job: DispatchableJob,
  deps: DispatchDeps = defaultDeps,
): Promise<DispatchResult> {
  if (job.urgency === "standard") return dispatchStandard(job, deps);
  if (job.urgency !== "emergency") {
    log.warn("dispatch.missing_urgency", { jobId: job.id });
  }
  return dispatchEmergency(job, deps);
}

// ---- Emergency acceptance ("first to reply YES wins") ----

export interface EmergencyAcceptResult {
  accepted: boolean;
  reason?: "unknown_provider" | "no_pending_job" | "already_filled";
  jobId?: string;
  providerId?: string;
}

// Handle a provider texting "yes" to an emergency offer. Wire this to the
// inbound-SMS webhook later (step 7 handles the standard 1/2/3 replies). Uses a
// status-guarded updateMany so a second "yes" that arrives after the job is
// already taken loses the race cleanly instead of double-assigning.
export async function handleEmergencyAccept(
  providerPhone: string,
  deps: DispatchDeps = defaultDeps,
): Promise<EmergencyAcceptResult> {
  const provider = await deps.prisma.provider.findFirst({
    where: { phone: providerPhone },
  });
  if (!provider) {
    log.warn("dispatch.accept.unknown_provider", { providerPhone });
    return { accepted: false, reason: "unknown_provider" };
  }

  // Find the most recent still-open emergency job this provider was offered.
  const dispatched = await deps.prisma.job.findMany({
    where: { status: "dispatched" },
  });
  const job = dispatched
    .filter((j) => j.dispatchedProviderIds.includes(provider.id))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (!job) {
    log.warn("dispatch.accept.no_pending_job", { providerId: provider.id });
    return { accepted: false, reason: "no_pending_job" };
  }

  // Guarded write: only the first "yes" flips a still-'dispatched' job.
  const { count } = await deps.prisma.job.updateMany({
    where: { id: job.id, status: "dispatched" },
    data: { status: "accepted", assignedProviderId: provider.id },
  });

  if (count === 0) {
    log.info("dispatch.accept.already_filled", {
      jobId: job.id,
      providerId: provider.id,
    });
    await deps.sendSms(provider.phone, emergencyFilledSms());
    return { accepted: false, reason: "already_filled", jobId: job.id };
  }

  const dispatchable: DispatchableJob = { ...job };

  // Reveal the address to the winner; tell the losers it's filled.
  await deps.sendSms(provider.phone, emergencyWonSms(dispatchable));

  const loserIds = job.dispatchedProviderIds.filter((id) => id !== provider.id);
  if (loserIds.length > 0) {
    const losers = await deps.prisma.provider.findMany({
      where: { id: { in: loserIds } },
    });
    await Promise.all(
      losers.map((p) => deps.sendSms(p.phone, emergencyFilledSms())),
    );
  }

  log.info("dispatch.accept.won", { jobId: job.id, providerId: provider.id });
  return { accepted: true, jobId: job.id, providerId: provider.id };
}
