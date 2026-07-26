import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { routeInboundSms } = await import("../src/inbound/router.js");
import type { InboundDeps } from "../src/inbound/router.js";
import type { Provider } from "@prisma/client";

const NOW = Date.parse("2026-07-25T19:00:00.000Z");
const PROVIDER_PHONE = "+1000000001";
const HOMEOWNER_PHONE = "+1999999999";

function provider(): Provider {
  return {
    id: "prov1",
    name: "Test Plumbing",
    phone: PROVIDER_PHONE,
    specialties: ["plumbing"],
    homeLat: 47.6,
    homeLng: -122.3,
    serviceRadiusMiles: 15,
    isVerified: true,
    isAvailable: true,
    createdAt: new Date(0),
  };
}

function makeFake(opts: { providers?: Provider[]; jobs?: any[] } = {}) {
  const providers = opts.providers ?? [];
  const jobs = opts.jobs ?? [];
  const upserts: any[] = [];
  const prisma = {
    provider: {
      findFirst: async ({ where }: any) => providers.find((p) => p.phone === where.phone) ?? null,
    },
    job: {
      findMany: async ({ where }: any = {}) =>
        jobs.filter((j) => {
          if (where?.status?.in && !where.status.in.includes(j.status)) return false;
          if (typeof where?.status === "string" && j.status !== where.status) return false;
          if (where?.homeownerPhone && j.homeownerPhone !== where.homeownerPhone) return false;
          return true;
        }),
    },
    bid: {
      upsert: async (args: any) => {
        upserts.push(args);
        return {} as any;
      },
    },
  };
  return { prisma, upserts };
}

function recorder() {
  const sent: { to: string; body: string }[] = [];
  return { sent, sendSms: async (to: string, body: string) => void sent.push({ to, body }) };
}

function deps(prisma: any, over: Partial<InboundDeps> = {}): InboundDeps {
  return {
    prisma,
    sendSms: over.sendSms ?? (async () => {}),
    parseBid: over.parseBid ?? (async () => null),
    handleEmergencyAccept: over.handleEmergencyAccept ?? (async () => ({ accepted: true })),
    handleHomeownerSelection: over.handleHomeownerSelection ?? (async () => ({ accepted: true })),
  };
}

function dispatchedJob() {
  return {
    id: "jobE",
    status: "dispatched",
    homeownerPhone: HOMEOWNER_PHONE,
    dispatchedProviderIds: ["prov1"],
    createdAt: new Date(NOW),
  };
}
function biddingJob() {
  return {
    id: "jobS",
    status: "bidding",
    homeownerPhone: HOMEOWNER_PHONE,
    dispatchedProviderIds: ["prov1"],
    createdAt: new Date(NOW),
  };
}

describe("routeInboundSms — provider", () => {
  it("emergency job + affirmative reply → handleEmergencyAccept", async () => {
    const { prisma } = makeFake({ providers: [provider()], jobs: [dispatchedJob()] });
    const handleEmergencyAccept = vi.fn(async () => ({ accepted: true, jobId: "jobE", providerId: "prov1" }));
    const out = await routeInboundSms(PROVIDER_PHONE, "YES", deps(prisma, { handleEmergencyAccept }));
    expect(out.kind).toBe("emergency_accept");
    expect(handleEmergencyAccept).toHaveBeenCalledWith(PROVIDER_PHONE);
  });

  it("emergency job + non-affirmative reply → ignored, no accept", async () => {
    const { prisma } = makeFake({ providers: [provider()], jobs: [dispatchedJob()] });
    const handleEmergencyAccept = vi.fn();
    const out = await routeInboundSms(PROVIDER_PHONE, "no thanks", deps(prisma, { handleEmergencyAccept }));
    expect(out.kind).toBe("emergency_ignored");
    expect(handleEmergencyAccept).not.toHaveBeenCalled();
  });

  it("bidding job + parseable bid → upserts bid and confirms", async () => {
    const { prisma, upserts } = makeFake({ providers: [provider()], jobs: [biddingJob()] });
    const { sent, sendSms } = recorder();
    const parseBid = vi.fn(async () => ({ priceCents: 18000, etaMinutes: 45 }));
    const out = await routeInboundSms(PROVIDER_PHONE, "$180, 45 min", deps(prisma, { parseBid, sendSms }));

    expect(out).toEqual({ kind: "bid_recorded", jobId: "jobS" });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].create).toMatchObject({ jobId: "jobS", providerId: "prov1", priceCents: 18000, etaMinutes: 45 });
    expect(sent[0].body).toContain("$180");
  });

  it("bidding job + unparseable → asks again, no upsert", async () => {
    const { prisma, upserts } = makeFake({ providers: [provider()], jobs: [biddingJob()] });
    const { sent, sendSms } = recorder();
    const parseBid = vi.fn(async () => null);
    const out = await routeInboundSms(PROVIDER_PHONE, "huh?", deps(prisma, { parseBid, sendSms }));

    expect(out).toEqual({ kind: "bid_unparseable", jobId: "jobS" });
    expect(upserts).toHaveLength(0);
    expect(sent[0].body.toLowerCase()).toContain("bid");
  });

  it("provider with no active job → no_active_job_for_provider", async () => {
    const { prisma } = makeFake({ providers: [provider()], jobs: [] });
    const out = await routeInboundSms(PROVIDER_PHONE, "hello", deps(prisma));
    expect(out).toEqual({ kind: "no_active_job_for_provider", providerId: "prov1" });
  });
});

describe("routeInboundSms — homeowner & unmatched", () => {
  it("homeowner with a quoted job → handleHomeownerSelection", async () => {
    const quoted = { id: "jobQ", status: "quoted", homeownerPhone: HOMEOWNER_PHONE, dispatchedProviderIds: [], createdAt: new Date(NOW) };
    const { prisma } = makeFake({ providers: [], jobs: [quoted] });
    const handleHomeownerSelection = vi.fn(async () => ({ accepted: true, jobId: "jobQ" }));
    const out = await routeInboundSms(HOMEOWNER_PHONE, "2", deps(prisma, { handleHomeownerSelection }));
    expect(out.kind).toBe("homeowner_selection");
    expect(handleHomeownerSelection).toHaveBeenCalledWith(HOMEOWNER_PHONE, "2");
  });

  it("unknown sender with nothing pending → unmatched", async () => {
    const { prisma } = makeFake({ providers: [], jobs: [] });
    const out = await routeInboundSms("+1555555555", "hi", deps(prisma));
    expect(out).toEqual({ kind: "unmatched" });
  });
});
