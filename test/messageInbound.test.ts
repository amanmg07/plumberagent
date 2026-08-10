import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Swap the shared prisma for an in-memory conversation fake.
const fake = vi.hoisted(() => ({ prisma: null as any }));
vi.mock("../src/db.js", () => ({
  get prisma() {
    return fake.prisma;
  },
}));

// Mock the agent turn and the outbound seam — the handler's job is orchestration.
const runIntakeTurnMock = vi.hoisted(() => vi.fn());
vi.mock("../src/agent/intakeAgent.js", () => ({ runIntakeTurn: runIntakeTurnMock }));
const sendMessageMock = vi.hoisted(() => vi.fn());
vi.mock("../src/messaging/sendMessage.js", () => ({ sendMessage: sendMessageMock }));

const { createApp } = await import("../src/app.js");

function makeConversationFake(seed: any[] = []) {
  const convos = new Map<string, any>(seed.map((c) => [c.id, c]));
  let n = 0;
  return {
    __convos: convos,
    conversation: {
      create: async ({ data }: any) => {
        const rec = {
          id: `conv_${++n}`,
          status: "collecting",
          description: null,
          address: null,
          photoUrls: [],
          transcript: "",
          completedAt: null,
          createdAt: new Date(),
          ...data,
        };
        convos.set(rec.id, rec);
        return rec;
      },
      findFirst: async ({ where }: any) =>
        [...convos.values()].find(
          (c) => c.homeownerPhone === where.homeownerPhone && c.status === where.status,
        ) ?? null,
      update: async ({ where, data }: any) => {
        const rec = convos.get(where.id);
        Object.assign(rec, data);
        return rec;
      },
    },
  };
}

describe("POST /webhooks/message-inbound", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runIntakeTurnMock.mockReset();
    sendMessageMock.mockReset().mockResolvedValue(undefined);
    app = createApp();
  });

  it("first message: creates a conversation, stays collecting, sends the reply", async () => {
    fake.prisma = makeConversationFake();
    runIntakeTurnMock.mockResolvedValue({
      description: "water heater leaking",
      address: null,
      reply: "Thanks! Could you send a photo and the address?",
    });

    const res = await request(app)
      .post("/webhooks/message-inbound")
      .send({ from: "+15557770001", text: "my water heater is leaking" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("collecting");
    expect(res.body.collected).toEqual({ description: true, photos: 0, address: false });
    expect(res.body.reply).toContain("photo");
    expect(sendMessageMock).toHaveBeenCalledWith("+15557770001", res.body.reply);
  });

  it("completes when the third objective arrives", async () => {
    // Conversation already has description + a photo; only address is missing.
    fake.prisma = makeConversationFake([
      {
        id: "conv_1",
        homeownerPhone: "+15557770001",
        status: "collecting",
        description: "water heater leaking",
        address: null,
        photoUrls: ["https://x/1.jpg"],
        transcript: "",
        createdAt: new Date(),
      },
    ]);
    runIntakeTurnMock.mockResolvedValue({
      description: null,
      address: "789 Maple Ave, Seattle",
      reply: "Perfect, a plumber will be in touch!",
    });

    const res = await request(app)
      .post("/webhooks/message-inbound")
      .send({ from: "+15557770001", text: "789 Maple Ave, Seattle" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("complete");
    expect(res.body.collected).toEqual({ description: true, photos: 1, address: true });
    const stored = fake.prisma.__convos.get("conv_1");
    expect(stored.status).toBe("complete");
    expect(stored.completedAt).toBeInstanceOf(Date);
    expect(stored.address).toBe("789 Maple Ave, Seattle");
  });

  it("counts an incoming photo toward the objectives", async () => {
    fake.prisma = makeConversationFake();
    runIntakeTurnMock.mockResolvedValue({ description: null, address: null, reply: "Got the photo!" });

    const res = await request(app)
      .post("/webhooks/message-inbound")
      .send({ from: "+15557770002", text: "here", mediaUrls: ["https://x/leak.jpg"] });

    expect(res.body.collected.photos).toBe(1);
    // Verify the photo was passed into the agent's state.
    expect(runIntakeTurnMock.mock.calls[0][0]).toMatchObject({ photoCount: 1 });
    expect(runIntakeTurnMock.mock.calls[0][2]).toBe(true); // photoAttachedThisMessage
  });

  it("missing 'from' → 400, agent not called", async () => {
    fake.prisma = makeConversationFake();
    const res = await request(app).post("/webhooks/message-inbound").send({ text: "hi" });
    expect(res.status).toBe(400);
    expect(runIntakeTurnMock).not.toHaveBeenCalled();
  });
});
