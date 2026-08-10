import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Replace only the shared turn core; keep the module's other exports (the app
// also imports messageInboundHandler from here). This test covers Twilio
// parsing + TwiML only.
const runTurnMock = vi.hoisted(() => vi.fn());
vi.mock("../src/webhooks/messageInbound.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/webhooks/messageInbound.js")>();
  return { ...actual, runConversationTurn: runTurnMock };
});

const { createApp } = await import("../src/app.js");

describe("POST /webhooks/whatsapp", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    runTurnMock.mockReset();
    runTurnMock.mockResolvedValue({
      conversationId: "conv_1",
      status: "collecting",
      collected: { description: true, photos: 0, address: false },
      reply: "Thanks! Could you send a photo & the address?",
    });
    app = createApp();
  });

  it("parses Twilio fields, strips whatsapp: prefix, replies with TwiML", async () => {
    const res = await request(app)
      .post("/webhooks/whatsapp")
      .type("form")
      .send({ From: "whatsapp:+15557770001", Body: "my sink is leaking", NumMedia: "0" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.text).toContain("<Message>Thanks! Could you send a photo &amp; the address?</Message>");

    // The core got a normalized message with the prefix stripped.
    expect(runTurnMock).toHaveBeenCalledWith({
      from: "+15557770001",
      text: "my sink is leaking",
      mediaUrls: [],
    });
  });

  it("maps NumMedia + MediaUrlN into mediaUrls", async () => {
    await request(app)
      .post("/webhooks/whatsapp")
      .type("form")
      .send({
        From: "whatsapp:+15557770001",
        Body: "here are photos",
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.com/media/a",
        MediaUrl1: "https://api.twilio.com/media/b",
      });

    expect(runTurnMock.mock.calls[0][0].mediaUrls).toEqual([
      "https://api.twilio.com/media/a",
      "https://api.twilio.com/media/b",
    ]);
  });

  it("missing From → 200 empty TwiML, core not called", async () => {
    const res = await request(app).post("/webhooks/whatsapp").type("form").send({ Body: "hi" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Response></Response>");
    expect(runTurnMock).not.toHaveBeenCalled();
  });

  it("still replies 200 with a graceful TwiML message if the turn throws", async () => {
    runTurnMock.mockRejectedValue(new Error("boom"));
    const res = await request(app)
      .post("/webhooks/whatsapp")
      .type("form")
      .send({ From: "whatsapp:+15557770001", Body: "hi", NumMedia: "0" });
    expect(res.status).toBe(200);
    expect(res.text.toLowerCase()).toContain("something went wrong");
  });
});
