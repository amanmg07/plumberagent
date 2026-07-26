// In-memory stand-in for the Prisma client, scoped to what the intake handler
// touches (job.create / job.findUnique). Records are readable back through the
// same object, so a test can assert "202 + job persisted with correct fields"
// as a real round-trip without a Postgres instance.
//
// To run these tests against a REAL database instead, drop this fake and point
// DATABASE_URL at a throwaway test DB: the handler already uses the shared
// `prisma` from src/db.ts, so only the vi.mock in the test file changes.

let seq = 0;

export interface FakeJob {
  id: string;
  homeownerPhone: string;
  category: string;
  description: string;
  photoUrls: string[];
  address: string;
  lat: number | null;
  lng: number | null;
  urgency: "emergency" | "standard" | null;
  triageConfidence: number | null;
  triageReasoning: string | null;
  status: string;
  rawTranscript: string | null;
  createdAt: Date;
  biddingExpiresAt: Date | null;
  dispatchedProviderIds: string[];
  assignedProviderId: string | null;
}

export function makeFakePrisma() {
  const jobs = new Map<string, FakeJob>();

  return {
    __jobs: jobs,
    job: {
      create: async ({ data }: { data: Partial<FakeJob> }): Promise<FakeJob> => {
        const id = `job_${++seq}`;
        const row: FakeJob = {
          id,
          homeownerPhone: data.homeownerPhone!,
          category: data.category ?? "plumbing",
          description: data.description!,
          photoUrls: data.photoUrls ?? [],
          address: data.address!,
          lat: data.lat ?? null,
          lng: data.lng ?? null,
          urgency: data.urgency ?? null,
          triageConfidence: data.triageConfidence ?? null,
          triageReasoning: data.triageReasoning ?? null,
          status: data.status ?? "posted",
          rawTranscript: data.rawTranscript ?? null,
          createdAt: new Date("2026-07-25T00:00:00.000Z"),
          biddingExpiresAt: null,
          dispatchedProviderIds: data.dispatchedProviderIds ?? [],
          assignedProviderId: data.assignedProviderId ?? null,
        };
        jobs.set(id, row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }): Promise<FakeJob | null> => {
        return jobs.get(where.id) ?? null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<FakeJob>;
      }): Promise<FakeJob> => {
        const existing = jobs.get(where.id);
        if (!existing) throw new Error(`job ${where.id} not found`);
        const updated = { ...existing, ...data };
        jobs.set(where.id, updated);
        return updated;
      },
    },
  };
}
