import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { parseBid } = await import("../src/bids/parse.js");
import type { ParseBidDeps } from "../src/bids/parse.js";

const FIXED_NOW = Date.parse("2026-07-25T19:00:00.000Z");

// Build deps whose fake client returns a tool_use block with the given input.
function clientReturning(input: unknown): ParseBidDeps {
  return {
    model: "test-model",
    now: () => FIXED_NOW,
    client: {
      messages: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (async () => ({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_bid", input }],
        })) as any,
      },
    } as ParseBidDeps["client"],
  };
}

function clientThrowing(): ParseBidDeps {
  return {
    model: "test-model",
    now: () => FIXED_NOW,
    client: {
      messages: {
        create: (async () => {
          throw new Error("boom");
        }) as unknown as ParseBidDeps["client"]["messages"]["create"],
      },
    } as ParseBidDeps["client"],
  };
}

describe("parseBid", () => {
  it("parses a clean bid into { priceCents, etaMinutes }", async () => {
    const res = await parseBid(
      "$180, there by 3pm",
      clientReturning({ parseable: true, price_cents: 18000, eta_minutes: 60 }),
    );
    expect(res).toEqual({ priceCents: 18000, etaMinutes: 60 });
  });

  it("returns null when the model marks it unparseable", async () => {
    const res = await parseBid(
      "who is this?",
      clientReturning({ parseable: false, price_cents: null, eta_minutes: null }),
    );
    expect(res).toBeNull();
  });

  it("returns null when a required value is null despite parseable=true", async () => {
    // e.g. price given but no ETA — treat as not a complete bid.
    const res = await parseBid(
      "$200",
      clientReturning({ parseable: true, price_cents: 20000, eta_minutes: null }),
    );
    expect(res).toBeNull();
  });

  it("returns null on invalid values (non-positive price, non-integer eta)", async () => {
    expect(
      await parseBid("free!", clientReturning({ parseable: true, price_cents: 0, eta_minutes: 30 })),
    ).toBeNull();
    expect(
      await parseBid("$100 soonish", clientReturning({ parseable: true, price_cents: 10000, eta_minutes: 12.5 })),
    ).toBeNull();
    expect(
      await parseBid("$-5", clientReturning({ parseable: true, price_cents: -500, eta_minutes: 10 })),
    ).toBeNull();
  });

  it("returns null for empty input without calling the API", async () => {
    const create = vi.fn();
    const deps: ParseBidDeps = {
      model: "test-model",
      now: () => FIXED_NOW,
      client: { messages: { create } } as unknown as ParseBidDeps["client"],
    };
    expect(await parseBid("   ", deps)).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("returns null (never throws) when the API errors", async () => {
    const res = await parseBid("$180, 30 min", clientThrowing());
    expect(res).toBeNull();
  });

  it("returns null when the response has no tool_use block", async () => {
    const deps: ParseBidDeps = {
      model: "test-model",
      now: () => FIXED_NOW,
      client: {
        messages: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: (async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] })) as any,
        },
      } as ParseBidDeps["client"],
    };
    expect(await parseBid("$180, 30 min", deps)).toBeNull();
  });
});
