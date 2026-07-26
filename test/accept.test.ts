import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { handleHomeownerSelection } = await import("../src/bids/accept.js");
import type { AcceptDeps } from "../src/bids/accept.js";
import type { Bid, Provider } from "@prisma/client";

const NOW = Date.parse("2026-07-25T19:00:00.000Z");
const HP = "+1999999999";

function bid(over: Partial<Bid> & Pick<Bid, "id" | "providerId">): Bid {
  return {
    jobId: "jQ",
    priceCents: 20000,
    etaMinutes: 30,
    rawText: "test",
    status: "submitted",
    createdAt: new Date(NOW),
    ...over,
  } as Bid;
}

function provider(id: string, phone: string): Provider {
  return {
    id,
    name: id,
    phone,
    specialties: ["plumbing"],
    homeLat: 47.6,
    homeLng: -122.3,
    serviceRadiusMiles: 15,
    isVerified: true,
    isAvailable: true,
    createdAt: new Date(0),
  };
}

// Store: jobs, bids, providers, with a $transaction that shares the store.
function makeFake(opts: { jobs?: any[]; bids?: Bid[]; providers?: Provider[] } = {}) {
  const jobMap = new Map((opts.jobs ?? []).map((j) => [j.id, j]));
  const bids = opts.bids ?? [];
  const providers = opts.providers ?? [];

  const tx = {
    job: {
      updateMany: async ({ where, data }: any) => {
        const j = jobMap.get(where.id);
        if (!j) return { count: 0 };
        if (where.status && j.status !== where.status) return { count: 0 };
        Object.assign(j, data);
        return { count: 1 };
      },
    },
    bid: {
      update: async ({ where, data }: any) => {
        const b = bids.find((x) => x.id === where.id)!;
        Object.assign(b, data);
        return b;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const b of bids) {
          if (where.jobId && b.jobId !== where.jobId) continue;
          if (where.id?.not && b.id === where.id.not) continue;
          Object.assign(b, data);
          count++;
        }
        return { count };
      },
    },
  };

  const prisma = {
    job: {
      findMany: async ({ where }: any = {}) =>
        [...jobMap.values()].filter(
          (j) =>
            (!where?.status || j.status === where.status) &&
            (!where?.homeownerPhone || j.homeownerPhone === where.homeownerPhone),
        ),
    },
    bid: {
      findMany: async ({ where }: any = {}) =>
        bids.filter(
          (b) =>
            (!where?.jobId || b.jobId === where.jobId) &&
            (!where?.status || b.status === where.status),
        ),
    },
    provider: {
      findUnique: async ({ where }: any) => providers.find((p) => p.id === where.id) ?? null,
      findMany: async ({ where }: any = {}) =>
        providers.filter((p) => !where?.id?.in || where.id.in.includes(p.id)),
    },
    $transaction: async (fn: any) => fn(tx),
  };

  return { prisma, jobMap, bids, providers };
}

function recorder() {
  const sent: { to: string; body: string }[] = [];
  return { sent, sendSms: async (to: string, body: string) => void sent.push({ to, body }) };
}

function deps(prisma: any, sendSms: any): AcceptDeps {
  return { prisma, sendSms };
}

// Standard fixture: one quoted job, three bids (ranked bW < bL1 < bL2).
function fixture() {
  return {
    jobs: [
      {
        id: "jQ",
        homeownerPhone: HP,
        address: "123 Pine St, Seattle, WA 98101",
        status: "quoted",
        createdAt: new Date(NOW),
        assignedProviderId: null,
      },
    ],
    bids: [
      bid({ id: "bW", providerId: "prov-w", priceCents: 18000, etaMinutes: 30 }),
      bid({ id: "bL1", providerId: "prov-l1", priceCents: 21000, etaMinutes: 40 }),
      bid({ id: "bL2", providerId: "prov-l2", priceCents: 25000, etaMinutes: 20 }),
    ],
    providers: [
      provider("prov-w", "+1000000001"),
      provider("prov-l1", "+1000000002"),
      provider("prov-l2", "+1000000003"),
    ],
  };
}

describe("handleHomeownerSelection", () => {
  it("books the picked option: accepts that bid, rejects the rest, assigns the job, reveals address", async () => {
    const { prisma, jobMap, bids } = makeFake(fixture());
    const { sent, sendSms } = recorder();

    // Option 2 = bL1 (prov-l1).
    const result = await handleHomeownerSelection(HP, "2", deps(prisma, sendSms));

    expect(result).toMatchObject({ accepted: true, jobId: "jQ", bidId: "bL1", providerId: "prov-l1" });

    const jobRow = jobMap.get("jQ");
    expect(jobRow.status).toBe("accepted");
    expect(jobRow.assignedProviderId).toBe("prov-l1");

    expect(bids.find((b) => b.id === "bL1")!.status).toBe("accepted");
    expect(bids.find((b) => b.id === "bW")!.status).toBe("rejected");
    expect(bids.find((b) => b.id === "bL2")!.status).toBe("rejected");

    // Winner (prov-l1) gets the address; homeowner gets a confirmation; losers notified.
    const winnerMsg = sent.find((m) => m.to === "+1000000002");
    expect(winnerMsg?.body).toContain("123 Pine St");
    const homeownerMsg = sent.find((m) => m.to === HP);
    expect(homeownerMsg?.body.toLowerCase()).toContain("booked");
    const loserMsgs = sent.filter((m) => m.to === "+1000000001" || m.to === "+1000000003");
    expect(loserMsgs).toHaveLength(2);
    for (const m of loserMsgs) expect(m.body.toLowerCase()).toContain("another plumber");
  });

  it("option 1 books the cheapest bid", async () => {
    const { prisma, jobMap } = makeFake(fixture());
    const { sendSms } = recorder();
    const result = await handleHomeownerSelection(HP, "1", deps(prisma, sendSms));
    expect(result.providerId).toBe("prov-w"); // cheapest
    expect(jobMap.get("jQ").assignedProviderId).toBe("prov-w");
  });

  it("out-of-range pick changes nothing and tells the homeowner", async () => {
    const fx = fixture();
    fx.bids = fx.bids.slice(0, 2); // only 2 options
    const { prisma, jobMap } = makeFake(fx);
    const { sent, sendSms } = recorder();

    const result = await handleHomeownerSelection(HP, "3", deps(prisma, sendSms));

    expect(result).toMatchObject({ accepted: false, reason: "selection_out_of_range" });
    expect(jobMap.get("jQ").status).toBe("quoted"); // unchanged
    expect(sent.some((m) => m.to === HP)).toBe(true);
  });

  it("invalid reply → asks the homeowner to reply with a number", async () => {
    const { prisma } = makeFake(fixture());
    const { sent, sendSms } = recorder();
    const result = await handleHomeownerSelection(HP, "not sure yet", deps(prisma, sendSms));
    expect(result).toEqual({ accepted: false, reason: "invalid_selection" });
    expect(sent[0].body).toMatch(/1-3/);
  });

  it("no quoted job for that phone → not accepted", async () => {
    const { prisma } = makeFake(fixture());
    const { sendSms } = recorder();
    const result = await handleHomeownerSelection("+1555555555", "2", deps(prisma, sendSms));
    expect(result).toEqual({ accepted: false, reason: "no_quoted_job" });
  });

  it("loses the race (job already accepted) → already_accepted, no side effects", async () => {
    const { prisma, bids } = makeFake(fixture());
    // Simulate a concurrent booking: the guarded claim finds no 'quoted' job.
    prisma.$transaction = (async (fn: any) =>
      fn({
        job: { updateMany: async () => ({ count: 0 }) },
        bid: { update: async () => {}, updateMany: async () => ({ count: 0 }) },
      })) as any;
    const { sent, sendSms } = recorder();

    const result = await handleHomeownerSelection(HP, "2", deps(prisma, sendSms));

    expect(result).toMatchObject({ accepted: false, reason: "already_accepted" });
    expect(bids.every((b) => b.status === "submitted")).toBe(true); // untouched
    expect(sent).toHaveLength(0); // no address reveal, no confirmations
  });
});
