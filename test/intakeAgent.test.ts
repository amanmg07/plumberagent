import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { runIntakeTurn } = await import("../src/agent/intakeAgent.js");
import type { IntakeAgentDeps, IntakeState } from "../src/agent/intakeAgent.js";

function clientReturning(input: unknown): IntakeAgentDeps {
  return {
    model: "test-model",
    client: {
      messages: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (async () => ({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t", name: "intake_turn", input }],
        })) as any,
      },
    } as IntakeAgentDeps["client"],
  };
}

const emptyState: IntakeState = { description: null, photoCount: 0, address: null };

describe("runIntakeTurn", () => {
  it("returns extracted fields and the reply", async () => {
    const res = await runIntakeTurn(
      emptyState,
      "my sink is leaking at 12 Pine St",
      false,
      clientReturning({
        description: "leaking sink",
        address: "12 Pine St",
        reply: "Thanks! Could you send a photo?",
      }),
    );
    expect(res).toEqual({
      description: "leaking sink",
      address: "12 Pine St",
      reply: "Thanks! Could you send a photo?",
    });
  });

  it("normalizes empty/blank extracted fields to null (keep existing upstream)", async () => {
    const res = await runIntakeTurn(
      emptyState,
      "hello",
      false,
      clientReturning({ description: "", address: "   ", reply: "Hi! What's the issue?" }),
    );
    expect(res.description).toBeNull();
    expect(res.address).toBeNull();
    expect(res.reply).toBe("Hi! What's the issue?");
  });

  it("falls back to a safe reply when there is no tool_use block", async () => {
    const deps: IntakeAgentDeps = {
      model: "m",
      client: {
        messages: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: (async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] })) as any,
        },
      } as IntakeAgentDeps["client"],
    };
    const res = await runIntakeTurn(emptyState, "x", false, deps);
    expect(res.description).toBeNull();
    expect(res.reply.toLowerCase()).toContain("issue");
  });

  it("never throws when the API errors", async () => {
    const deps: IntakeAgentDeps = {
      model: "m",
      client: {
        messages: {
          create: (async () => {
            throw new Error("boom");
          }) as unknown as IntakeAgentDeps["client"]["messages"]["create"],
        },
      } as IntakeAgentDeps["client"],
    };
    const res = await runIntakeTurn(emptyState, "x", false, deps);
    expect(res.reply).toBeTruthy();
    expect(res.description).toBeNull();
  });
});
