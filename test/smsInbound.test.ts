import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock the router — the HTTP layer only needs to validate, delegate, and ack.
// Routing logic is covered in test/inbound.router.test.ts.
const routeMock = vi.hoisted(() => vi.fn());
vi.mock("../src/inbound/router.js", () => ({ routeInboundSms: routeMock }));

const { createApp } = await import("../src/app.js");

describe("POST /webhooks/sms-inbound", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    routeMock.mockReset();
    routeMock.mockResolvedValue({ kind: "unmatched" });
    app = createApp();
  });

  it("valid Twilio form post → 200 TwiML and router invoked", async () => {
    const res = await request(app)
      .post("/webhooks/sms-inbound")
      .type("form")
      .send({ From: "+12065551234", Body: "YES", MessageSid: "SM123" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.text).toContain("<Response>");
    expect(routeMock).toHaveBeenCalledWith("+12065551234", "YES");
  });

  it("missing From → 400, router not called", async () => {
    const res = await request(app)
      .post("/webhooks/sms-inbound")
      .type("form")
      .send({ Body: "YES" });

    expect(res.status).toBe(400);
    expect(routeMock).not.toHaveBeenCalled();
  });

  it("still acks 200 even if the router throws", async () => {
    routeMock.mockRejectedValue(new Error("boom"));
    const res = await request(app)
      .post("/webhooks/sms-inbound")
      .type("form")
      .send({ From: "+12065551234", Body: "hi" });

    expect(res.status).toBe(200); // don't make Twilio retry-storm
  });
});
