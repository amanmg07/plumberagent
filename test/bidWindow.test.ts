import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { rankBids } = await import("../src/bids/rank.js");
const { closeExpiredBidWindows } = await import("../src/bids/close.js");
import type { CloseDeps } from "../src/bids/close.js";
import type { Bid } from "@prisma/client";

const NOW = Date.parse("2026-07-25T19:00:00.000Z");

function bid(over: Partial<Bid> & Pick<Bid, "id" | "jobId">): Bid {
  return {
    providerId: `prov-${over.id}`,
    priceCents: 20000,
    etaMinutes: 30,
    rawText: "test",
    status: "submitted",
    createdAt: new Date(NOW),
    ...over,
  } as Bid;
}

describe("rankBids", () => {
  it("orders by price, then eta, then createdAt, then id", () => {
    const bids = [
      bid({ id: "a", jobId: "j", priceCents: 21000, etaMinutes: 40 }),
      bid({ id: "b", jobId: "j", priceCents: 18000, etaMinutes: 60 }),
      bid({ id: "c", jobId: "j", priceCents: 25000, etaMinutes: 20 }),
      bid({ id: "d", jobId: "j", priceCents: 18000, etaMinutes: 30 }), // ties price with b, lower eta
    ];
    expect(rankBids(bids).map((b) => b.id)).toEqual(["d", "b", "a", "c"]);
  });

  it("does not mutate the input array", () => {
    const bids = [
      bid({ id: "a", jobId: "j", priceCents: 30000 }),
      bid({ id: "b", jobId: "j", priceCents: 10000 }),
    ];
    rankBids(bids);
    expect(bids.map((b) => b.id)).toEqual(["a", "b"]);
  });
});

// Fake Prisma for the sweep: an in-memory job map + a per-job bid list.
function makeFake(jobs: any[], bidsByJob: Record<string, Bid[]>) {
  const jobMap = new Map(jobs.map((j) => [j.id, j]));
  const prisma = {
    job: {
      findMany: async (args?: any) => {
        const where = args?.where ?? {};
        return [...jobMap.values()].filter((j) => {
          if (where.status && j.status !== where.status) return false;
          if (where.biddingExpiresAt?.lte) {
            if (!j.biddingExpiresAt) return false;
            if (j.biddingExpiresAt.getTime() > where.biddingExpiresAt.lte.getTime()) return false;
          }
          return true;
        });
      },
      update: async ({ where, data }: any) => {
        const j = jobMap.get(where.id);
        Object.assign(j, data);
        return j;
      },
    },
    bid: {
      findMany: async (args?: any) => {
        const where = args?.where ?? {};
        return (bidsByJob[where.jobId] ?? []).filter(
          (b) => !where.status || b.status === where.status,
        );
      },
    },
  };
  return { prisma, jobMap };
}

function recorder() {
  const sent: { to: string; body: string }[] = [];
  return { sent, sendSms: async (to: string, body: string) => void sent.push({ to, body }) };
}

function deps(prisma: any, sendSms: any): CloseDeps {
  return { prisma, sendSms, now: () => NOW };
}

function job(over: any) {
  return {
    id: "j",
    homeownerPhone: "+1999999999",
    status: "bidding",
    biddingExpiresAt: new Date(NOW - 60_000), // expired by default
    ...over,
  };
}

describe("closeExpiredBidWindows", () => {
  it("quotes the top 3 (cheapest first) and moves the job to 'quoted'", async () => {
    const jobs = [job({ id: "jA" })];
    const bids = {
      jA: [
        bid({ id: "b1", jobId: "jA", priceCents: 21000, etaMinutes: 40 }),
        bid({ id: "b2", jobId: "jA", priceCents: 18000, etaMinutes: 60 }),
        bid({ id: "b3", jobId: "jA", priceCents: 25000, etaMinutes: 20 }),
        bid({ id: "b4", jobId: "jA", priceCents: 18000, etaMinutes: 30 }),
      ],
    };
    const { prisma, jobMap } = makeFake(jobs, bids);
    const { sent, sendSms } = recorder();

    const results = await closeExpiredBidWindows(deps(prisma, sendSms));

    expect(results).toEqual([{ jobId: "jA", outcome: "quoted", optionCount: 3 }]);
    expect(jobMap.get("jA").status).toBe("quoted");

    expect(sent).toHaveLength(1);
    const body = sent[0].body;
    expect(sent[0].to).toBe("+1999999999");
    // Ranked b4 ($180/30), b2 ($180/60), b1 ($210/40); b3 ($250) excluded.
    expect(body).toContain("1) $180 — arrives in ~30 min");
    expect(body).toContain("2) $180 — arrives in ~60 min");
    expect(body).toContain("3) $210 — arrives in ~40 min");
    expect(body).not.toContain("$250");
  });

  it("cancels and notifies when the window closed with no bids", async () => {
    const jobs = [job({ id: "jB" })];
    const { prisma, jobMap } = makeFake(jobs, { jB: [] });
    const { sent, sendSms } = recorder();

    const results = await closeExpiredBidWindows(deps(prisma, sendSms));

    expect(results).toEqual([{ jobId: "jB", outcome: "no_bids" }]);
    expect(jobMap.get("jB").status).toBe("cancelled");
    expect(sent[0].body.toLowerCase()).toContain("no plumbers bid");
  });

  it("ignores jobs whose window hasn't elapsed and non-bidding jobs", async () => {
    const jobs = [
      job({ id: "future", biddingExpiresAt: new Date(NOW + 5 * 60_000) }),
      job({ id: "alreadyQuoted", status: "quoted" }),
    ];
    const { prisma, jobMap } = makeFake(jobs, {
      future: [bid({ id: "x", jobId: "future" })],
      alreadyQuoted: [bid({ id: "y", jobId: "alreadyQuoted" })],
    });
    const { sent, sendSms } = recorder();

    const results = await closeExpiredBidWindows(deps(prisma, sendSms));

    expect(results).toEqual([]);
    expect(sent).toHaveLength(0);
    expect(jobMap.get("future").status).toBe("bidding");
    expect(jobMap.get("alreadyQuoted").status).toBe("quoted");
  });

  it("processes multiple expired jobs in one sweep", async () => {
    const jobs = [job({ id: "j1" }), job({ id: "j2" })];
    const { prisma } = makeFake(jobs, {
      j1: [bid({ id: "a", jobId: "j1", priceCents: 15000 })],
      j2: [],
    });
    const { sent, sendSms } = recorder();

    const results = await closeExpiredBidWindows(deps(prisma, sendSms));

    expect(results).toHaveLength(2);
    expect(results.find((r) => r.jobId === "j1")?.outcome).toBe("quoted");
    expect(results.find((r) => r.jobId === "j2")?.outcome).toBe("no_bids");
    expect(sent).toHaveLength(2);
  });
});
