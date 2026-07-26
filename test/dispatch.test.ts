import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  findEligibleProviders,
} = await import("../src/dispatch/match.js");
const {
  dispatch,
  dispatchEmergency,
  dispatchStandard,
  handleEmergencyAccept,
} = await import("../src/dispatch/dispatch.js");
import type { DispatchDeps, DispatchableJob } from "../src/dispatch/dispatch.js";
import type { Provider } from "@prisma/client";

// Job sits at downtown Seattle. Providers are placed at known distances so
// ordering and radius gating are deterministic.
const JOB_LAT = 47.6062;
const JOB_LNG = -122.3321;

function provider(over: Partial<Provider> & Pick<Provider, "id" | "phone">): Provider {
  return {
    name: over.id,
    specialties: ["plumbing"],
    homeLat: JOB_LAT,
    homeLng: JOB_LNG,
    serviceRadiusMiles: 15,
    isVerified: true,
    isAvailable: true,
    createdAt: new Date(0),
    ...over,
  } as Provider;
}

// p1 closest, then p4 (unverified), then p2, then p3 (far but big radius).
// p5 unavailable, p6 hvac-only, p7 out of range — all should be excluded.
const PROVIDERS: Provider[] = [
  provider({ id: "p1", phone: "+1000000001", homeLat: 47.61, homeLng: -122.335 }),
  provider({ id: "p2", phone: "+1000000002", homeLat: 47.65, homeLng: -122.35 }),
  provider({ id: "p3", phone: "+1000000003", homeLat: 47.5, homeLng: -122.2, serviceRadiusMiles: 30 }),
  provider({ id: "p4", phone: "+1000000004", homeLat: 47.612, homeLng: -122.34, isVerified: false }),
  provider({ id: "p5", phone: "+1000000005", isAvailable: false }),
  provider({ id: "p6", phone: "+1000000006", specialties: ["hvac"] }),
  provider({ id: "p7", phone: "+1000000007", homeLat: 47.5, homeLng: -122.5, serviceRadiusMiles: 3 }),
];

function job(over: Partial<DispatchableJob> = {}): DispatchableJob {
  return {
    id: "job1",
    category: "plumbing",
    description: "leaky pipe",
    photoUrls: ["https://cdn.example.com/a.jpg"],
    address: "123 Pine St, Seattle, WA 98101",
    homeownerPhone: "+1999999999",
    lat: JOB_LAT,
    lng: JOB_LNG,
    urgency: "emergency",
    dispatchedProviderIds: [],
    ...over,
  };
}

// Minimal Prisma fake for dispatch. Backed by an in-memory job map + the fixed
// provider list, supporting only the queries dispatch issues.
function makeFake(jobs: Record<string, any> = {}) {
  const jobMap = new Map<string, any>(Object.entries(jobs));
  const prisma = {
    provider: {
      findMany: async (args?: any) => {
        let list = PROVIDERS;
        const where = args?.where ?? {};
        if (where.isAvailable !== undefined) list = list.filter((p) => p.isAvailable === where.isAvailable);
        if (where.id?.in) list = list.filter((p) => where.id.in.includes(p.id));
        return list;
      },
      findFirst: async (args?: any) => {
        const where = args?.where ?? {};
        return PROVIDERS.find((p) => (where.phone ? p.phone === where.phone : true)) ?? null;
      },
    },
    job: {
      update: async ({ where, data }: any) => {
        const j = jobMap.get(where.id);
        Object.assign(j, data);
        return j;
      },
      updateMany: async ({ where, data }: any) => {
        const j = jobMap.get(where.id);
        if (!j) return { count: 0 };
        if (where.status && j.status !== where.status) return { count: 0 };
        Object.assign(j, data);
        return { count: 1 };
      },
      findMany: async (args?: any) => {
        const where = args?.where ?? {};
        let list = [...jobMap.values()];
        if (where.status) list = list.filter((j) => j.status === where.status);
        return list;
      },
    },
  };
  return { prisma, jobMap };
}

function recorder() {
  const sent: { to: string; body: string }[] = [];
  return {
    sent,
    sendSms: async (to: string, body: string) => {
      sent.push({ to, body });
    },
  };
}

const FIXED_NOW = Date.parse("2026-07-25T12:00:00.000Z");

function deps(prisma: any, sendSms: any): DispatchDeps {
  return { prisma, sendSms, now: () => FIXED_NOW };
}

describe("findEligibleProviders", () => {
  it("emergency: verified + available + in-range, nearest first", () => {
    const matches = findEligibleProviders(job(), PROVIDERS, {
      requireVerified: true,
      limit: 3,
    });
    expect(matches.map((m) => m.provider.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("standard: includes the unverified provider (p4)", () => {
    const matches = findEligibleProviders(job(), PROVIDERS, {
      requireVerified: false,
      limit: 5,
    });
    // p1 closest, then unverified p4, then p2, then p3. p5/p6/p7 excluded.
    expect(matches.map((m) => m.provider.id)).toEqual(["p1", "p4", "p2", "p3"]);
  });

  it("returns [] when the job has no coordinates", () => {
    const matches = findEligibleProviders(job({ lat: null, lng: null }), PROVIDERS, {
      requireVerified: false,
      limit: 5,
    });
    expect(matches).toEqual([]);
  });

  it("respects the limit", () => {
    const matches = findEligibleProviders(job(), PROVIDERS, {
      requireVerified: false,
      limit: 2,
    });
    expect(matches).toHaveLength(2);
  });
});

describe("dispatchEmergency", () => {
  it("marks dispatched, records the top-3 verified, texts them (no address)", async () => {
    const { prisma, jobMap } = makeFake({ job1: { ...job(), status: "posted" } });
    const { sent, sendSms } = recorder();

    const result = await dispatchEmergency(job(), deps(prisma, sendSms));

    expect(result.path).toBe("emergency");
    expect(result.contactedProviderIds).toEqual(["p1", "p2", "p3"]);

    const stored = jobMap.get("job1");
    expect(stored.status).toBe("dispatched");
    expect(stored.dispatchedProviderIds).toEqual(["p1", "p2", "p3"]);

    expect(sent).toHaveLength(3);
    for (const msg of sent) {
      expect(msg.body).toContain("URGENT");
      expect(msg.body).not.toContain("123 Pine St"); // address withheld
    }
  });
});

describe("dispatchStandard", () => {
  it("opens a 15-min window to the 5 nearest, texts them (no address)", async () => {
    const { prisma, jobMap } = makeFake({ job1: { ...job(), status: "posted" } });
    const { sent, sendSms } = recorder();

    const result = await dispatchStandard(job({ urgency: "standard" }), deps(prisma, sendSms));

    expect(result.path).toBe("standard");
    // Only 4 eligible (p1, p4, p2, p3) — fewer than the 5-cap.
    expect(result.contactedProviderIds).toEqual(["p1", "p4", "p2", "p3"]);
    expect(result.biddingExpiresAt?.getTime()).toBe(FIXED_NOW + 15 * 60_000);

    const stored = jobMap.get("job1");
    expect(stored.status).toBe("bidding");
    expect(stored.biddingExpiresAt.getTime()).toBe(FIXED_NOW + 15 * 60_000);

    expect(sent).toHaveLength(4);
    for (const msg of sent) {
      expect(msg.body).not.toContain("123 Pine St"); // address withheld
      expect(msg.body.toLowerCase()).toContain("price");
    }
  });

  it("logs and does nothing when no providers are eligible", async () => {
    const { prisma, jobMap } = makeFake({ job1: { ...job(), status: "posted" } });
    const { sent, sendSms } = recorder();

    // A job far outside every provider's radius.
    const result = await dispatchStandard(
      job({ urgency: "standard", lat: 40.0, lng: -100.0 }),
      deps(prisma, sendSms),
    );

    expect(result.contactedProviderIds).toEqual([]);
    expect(sent).toHaveLength(0);
    expect(jobMap.get("job1").status).toBe("posted"); // unchanged
  });
});

describe("dispatch router", () => {
  it("routes standard jobs to the auction", async () => {
    const { prisma } = makeFake({ job1: { ...job(), status: "posted" } });
    const { sendSms } = recorder();
    const result = await dispatch(job({ urgency: "standard" }), deps(prisma, sendSms));
    expect(result.path).toBe("standard");
  });

  it("routes emergency jobs to the race", async () => {
    const { prisma } = makeFake({ job1: { ...job(), status: "posted" } });
    const { sendSms } = recorder();
    const result = await dispatch(job({ urgency: "emergency" }), deps(prisma, sendSms));
    expect(result.path).toBe("emergency");
  });
});

describe("handleEmergencyAccept", () => {
  function dispatchedJob() {
    return {
      ...job(),
      status: "dispatched",
      dispatchedProviderIds: ["p1", "p2", "p3"],
      createdAt: new Date(FIXED_NOW),
    };
  }

  it("first 'yes' wins: assigns job, reveals address, tells losers it's filled", async () => {
    const { prisma, jobMap } = makeFake({ job1: dispatchedJob() });
    const { sent, sendSms } = recorder();

    const result = await handleEmergencyAccept("+1000000002", deps(prisma, sendSms)); // p2

    expect(result).toMatchObject({ accepted: true, jobId: "job1", providerId: "p2" });

    const stored = jobMap.get("job1");
    expect(stored.status).toBe("accepted");
    expect(stored.assignedProviderId).toBe("p2");

    // Winner (p2) gets the address; losers (p1, p3) get a filled notice.
    const winnerMsg = sent.find((m) => m.to === "+1000000002");
    expect(winnerMsg?.body).toContain("123 Pine St");
    const loserPhones = sent.filter((m) => m.to !== "+1000000002").map((m) => m.to);
    expect(loserPhones.sort()).toEqual(["+1000000001", "+1000000003"]);
    for (const m of sent.filter((m) => m.to !== "+1000000002")) {
      expect(m.body.toLowerCase()).toContain("filled");
    }
  });

  it("a late 'yes' after the job is filled → no pending job", async () => {
    const { prisma, jobMap } = makeFake({ job1: dispatchedJob() });
    const { sendSms } = recorder();

    await handleEmergencyAccept("+1000000002", deps(prisma, sendSms)); // p2 wins
    // p1 was already told 'filled' during p2's win. If p1 replies anyway, the
    // job is no longer 'dispatched', so there's nothing pending for them.
    const rec2 = recorder();
    const second = await handleEmergencyAccept("+1000000001", deps(prisma, rec2.sendSms));

    expect(second).toMatchObject({ accepted: false, reason: "no_pending_job" });
    expect(jobMap.get("job1").assignedProviderId).toBe("p2"); // unchanged
  });

  it("loses the guarded write race → already_filled + filled notice", async () => {
    // Simulate two 'yes' replies landing concurrently: the job still reads as
    // 'dispatched', but the guarded updateMany finds it already taken (count 0).
    const { prisma } = makeFake({ job1: dispatchedJob() });
    prisma.job.updateMany = async () => ({ count: 0 });
    const { sent, sendSms } = recorder();

    const result = await handleEmergencyAccept("+1000000001", deps(prisma, sendSms));

    expect(result).toMatchObject({ accepted: false, reason: "already_filled", jobId: "job1" });
    expect(sent[0].body.toLowerCase()).toContain("filled");
  });

  it("unknown provider phone → not accepted", async () => {
    const { prisma } = makeFake({ job1: dispatchedJob() });
    const { sendSms } = recorder();
    const result = await handleEmergencyAccept("+1555555555", deps(prisma, sendSms));
    expect(result).toEqual({ accepted: false, reason: "unknown_provider" });
  });

  it("provider with no pending emergency → not accepted", async () => {
    const { prisma } = makeFake({}); // no dispatched jobs
    const { sendSms } = recorder();
    const result = await handleEmergencyAccept("+1000000002", deps(prisma, sendSms));
    expect(result).toEqual({ accepted: false, reason: "no_pending_job" });
  });
});
