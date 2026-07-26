import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { makeFakePrisma } from "./fakes/prismaFake.js";

// Swap the shared Prisma client for the in-memory fake. Must be hoisted before
// the app (and its handler) import src/db.js.
const fake = vi.hoisted(() => {
  return { prisma: null as ReturnType<typeof import("./fakes/prismaFake.js").makeFakePrisma> | null };
});

vi.mock("../src/db.js", () => ({
  get prisma() {
    return fake.prisma;
  },
}));

// Quiet the structured logger during tests.
vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Stub the triage classifier so the webhook test never hits the Claude API.
// classify()'s own logic is covered in test/triage.classify.test.ts.
const classifyMock = vi.hoisted(() => vi.fn());
vi.mock("../src/triage/classify.js", () => ({ classify: classifyMock }));

// Stub dispatch — the webhook only needs to hand off. Dispatch's own behavior
// is covered in test/dispatch.test.ts.
const dispatchMock = vi.hoisted(() => vi.fn());
vi.mock("../src/dispatch/dispatch.js", () => ({ dispatch: dispatchMock }));

const { createApp } = await import("../src/app.js");

const validPayload = {
  homeownerPhone: "+12065551234",
  description: "Water pouring out from under the kitchen sink, cabinet is soaked.",
  photoUrls: ["https://cdn.example.com/leak1.jpg", "https://cdn.example.com/leak2.jpg"],
  address: "123 Pine St, Seattle, WA 98101",
  rawTranscript: "Homeowner: my sink is flooding. Agent: how long has it been leaking...",
};

describe("POST /webhooks/intake-complete", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    fake.prisma = makeFakePrisma();
    classifyMock.mockReset();
    classifyMock.mockResolvedValue({
      urgency: "emergency",
      confidence: 0.92,
      reasoning: "active flooding",
    });
    dispatchMock.mockReset();
    dispatchMock.mockResolvedValue({ path: "emergency", contactedProviderIds: [] });
    app = createApp();
  });

  it("valid payload → 202 and persists a job with correct fields", async () => {
    const res = await request(app).post("/webhooks/intake-complete").send(validPayload);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ jobId: expect.any(String), status: "received" });

    // Round-trip: read the job back out of the (fake) DB.
    const job = await fake.prisma!.job.findUnique({ where: { id: res.body.jobId } });
    expect(job).not.toBeNull();
    expect(job).toMatchObject({
      homeownerPhone: validPayload.homeownerPhone,
      category: "plumbing",
      description: validPayload.description,
      photoUrls: validPayload.photoUrls,
      address: validPayload.address,
      rawTranscript: validPayload.rawTranscript,
      status: "posted",
    });
    // Geocode stub populated coarse coords for matching.
    expect(typeof job!.lat).toBe("number");
    expect(typeof job!.lng).toBe("number");
    // Triage ran and its result was persisted (dispatch is still step 4).
    expect(classifyMock).toHaveBeenCalledOnce();
    expect(job!.urgency).toBe("emergency");
    expect(job!.triageConfidence).toBe(0.92);
    expect(job!.triageReasoning).toBe("active flooding");
    // Dispatch was handed the triaged job.
    expect(dispatchMock).toHaveBeenCalledOnce();
    expect(dispatchMock.mock.calls[0][0]).toMatchObject({ urgency: "emergency" });
  });

  it("missing address → 400 with a validation issue for address", async () => {
    const { address, ...noAddress } = validPayload;
    const res = await request(app).post("/webhooks/intake-complete").send(noAddress);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.issues.some((i: any) => i.path === "address")).toBe(true);
    // Nothing persisted.
    expect(fake.prisma!.__jobs.size).toBe(0);
  });

  it("malformed photoUrls (not URLs) → 400", async () => {
    const res = await request(app)
      .post("/webhooks/intake-complete")
      .send({ ...validPayload, photoUrls: ["not-a-url", 42] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_failed");
    expect(res.body.issues.some((i: any) => i.path.startsWith("photoUrls"))).toBe(true);
    expect(fake.prisma!.__jobs.size).toBe(0);
  });

  it("malformed JSON body → 400 malformed_json", async () => {
    const res = await request(app)
      .post("/webhooks/intake-complete")
      .set("Content-Type", "application/json")
      .send('{"homeownerPhone": "+120655512');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("malformed_json");
  });
});
