// In-memory stand-in for the Prisma client, covering exactly the queries the
// app issues. Activated only when USE_FAKE_DB=1 (see `npm run dev:fake`) so you
// can drive the real app with no Postgres. NOT for production.

interface Store {
  jobs: Map<string, any>;
  bids: Map<string, any>;
  providers: Map<string, any>;
}

const store: Store = { jobs: new Map(), bids: new Map(), providers: new Map() };

let seq = 0;
const nextId = (prefix: string) => `${prefix}_${++seq}`;

// Minimal where-matcher: supports scalar equality and the operators the app
// actually uses ({in}, {lte}, {gte}, {not}).
function matchWhere(rec: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    const rv = rec[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const op = v as any;
      if ("in" in op) {
        if (!op.in.includes(rv)) return false;
      } else if ("lte" in op) {
        if (!(rv instanceof Date) || rv.getTime() > op.lte.getTime()) return false;
      } else if ("gte" in op) {
        if (!(rv instanceof Date) || rv.getTime() < op.gte.getTime()) return false;
      } else if ("not" in op) {
        if (rv === op.not) return false;
      } else {
        return false; // unsupported operator
      }
    } else if (rv !== v) {
      return false;
    }
  }
  return true;
}

export const memoryPrisma = {
  job: {
    create: async ({ data }: any) => {
      const rec = {
        id: nextId("job"),
        createdAt: new Date(),
        status: "posted",
        urgency: null,
        triageConfidence: null,
        triageReasoning: null,
        photoUrls: [],
        rawTranscript: null,
        lat: null,
        lng: null,
        biddingExpiresAt: null,
        dispatchedProviderIds: [],
        assignedProviderId: null,
        ...data,
      };
      store.jobs.set(rec.id, rec);
      return rec;
    },
    update: async ({ where, data }: any) => {
      const rec = store.jobs.get(where.id);
      Object.assign(rec, data);
      return rec;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const rec of store.jobs.values()) {
        if (matchWhere(rec, where)) {
          Object.assign(rec, data);
          count++;
        }
      }
      return { count };
    },
    findMany: async ({ where }: any = {}) =>
      [...store.jobs.values()].filter((r) => matchWhere(r, where)),
    findUnique: async ({ where }: any) => store.jobs.get(where.id) ?? null,
  },

  provider: {
    create: async ({ data }: any) => {
      const rec = {
        id: nextId("prov"),
        createdAt: new Date(),
        isVerified: false,
        isAvailable: true,
        specialties: [],
        ...data,
      };
      store.providers.set(rec.id, rec);
      return rec;
    },
    findMany: async ({ where }: any = {}) =>
      [...store.providers.values()].filter((r) => matchWhere(r, where)),
    findFirst: async ({ where }: any = {}) =>
      [...store.providers.values()].find((r) => matchWhere(r, where)) ?? null,
    findUnique: async ({ where }: any) => store.providers.get(where.id) ?? null,
  },

  bid: {
    findMany: async ({ where }: any = {}) =>
      [...store.bids.values()].filter((r) => matchWhere(r, where)),
    update: async ({ where, data }: any) => {
      const rec = store.bids.get(where.id);
      Object.assign(rec, data);
      return rec;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const rec of store.bids.values()) {
        if (matchWhere(rec, where)) {
          Object.assign(rec, data);
          count++;
        }
      }
      return { count };
    },
    // Compound-unique upsert: one bid per (jobId, providerId).
    upsert: async ({ where, create, update }: any) => {
      const key = where.one_bid_per_provider_per_job;
      const existing = [...store.bids.values()].find(
        (b) => b.jobId === key.jobId && b.providerId === key.providerId,
      );
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const rec = { id: nextId("bid"), createdAt: new Date(), status: "submitted", ...create };
      store.bids.set(rec.id, rec);
      return rec;
    },
  },

  // Our code's transactions just need the same client passed as `tx`.
  $transaction: async (fn: any) => fn(memoryPrisma),
};

// Inspection / reset helpers for the dev routes.
export const memoryStore = {
  snapshot: () => ({
    jobs: [...store.jobs.values()],
    bids: [...store.bids.values()],
    providers: [...store.providers.values()],
  }),
  // Clear jobs and bids but keep the seeded providers.
  resetJobsAndBids: () => {
    store.jobs.clear();
    store.bids.clear();
  },
};
