import { describe, expect, it, vi } from "vitest";

// Silence the structured logger for these tests.
vi.mock("../src/lib/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { classify, applyConfidenceGate, CONFIDENCE_THRESHOLD } = await import(
  "../src/triage/classify.js"
);
import type { ClassifyDeps, TriageResult } from "../src/triage/classify.js";

// Build a fake Anthropic client whose messages.create returns a tool_use block
// with the given input — i.e. simulate the model's structured answer.
function clientReturning(input: unknown): ClassifyDeps {
  return {
    model: "test-model",
    client: {
      messages: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        create: (async () => ({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_triage", input }],
        })) as any,
      },
    } as ClassifyDeps["client"],
  };
}

function clientThrowing(): ClassifyDeps {
  return {
    model: "test-model",
    client: {
      messages: {
        create: (async () => {
          throw new Error("boom");
        }) as unknown as ClassifyDeps["client"]["messages"]["create"],
      },
    } as ClassifyDeps["client"],
  };
}

const input = {
  description: "pipe leak",
  rawTranscript: "Caller: there's a leak",
  photoUrls: [],
};

describe("applyConfidenceGate", () => {
  it("passes through a high-confidence classification unchanged", () => {
    const raw: TriageResult = { urgency: "standard", confidence: 0.9, reasoning: "slow drip" };
    expect(applyConfidenceGate(raw)).toEqual(raw);
  });

  it("forces emergency when confidence is below threshold", () => {
    const raw: TriageResult = { urgency: "standard", confidence: 0.4, reasoning: "unsure" };
    expect(applyConfidenceGate(raw).urgency).toBe("emergency");
  });

  it("threshold is inclusive — exactly at threshold is trusted", () => {
    const raw: TriageResult = {
      urgency: "standard",
      confidence: CONFIDENCE_THRESHOLD,
      reasoning: "borderline",
    };
    expect(applyConfidenceGate(raw).urgency).toBe("standard");
  });
});

describe("classify", () => {
  it("returns a confident emergency as-is", async () => {
    const res = await classify(
      input,
      clientReturning({ urgency: "emergency", confidence: 0.95, reasoning: "flooding" }),
    );
    expect(res).toEqual({ urgency: "emergency", confidence: 0.95, reasoning: "flooding" });
  });

  it("returns a confident standard as-is", async () => {
    const res = await classify(
      input,
      clientReturning({ urgency: "standard", confidence: 0.88, reasoning: "cosmetic" }),
    );
    expect(res.urgency).toBe("standard");
  });

  it("overrides a low-confidence 'standard' to 'emergency'", async () => {
    const res = await classify(
      input,
      clientReturning({ urgency: "standard", confidence: 0.5, reasoning: "ambiguous" }),
    );
    expect(res.urgency).toBe("emergency");
    expect(res.confidence).toBe(0.5); // score preserved for review
  });

  it("clamps out-of-range confidence into [0,1]", async () => {
    const high = await classify(
      input,
      clientReturning({ urgency: "emergency", confidence: 1.7, reasoning: "x" }),
    );
    expect(high.confidence).toBe(1);

    const low = await classify(
      input,
      clientReturning({ urgency: "emergency", confidence: -3, reasoning: "x" }),
    );
    expect(low.confidence).toBe(0);
  });

  it("falls back to emergency/0 on empty input without calling the API", async () => {
    const create = vi.fn();
    const deps: ClassifyDeps = {
      model: "test-model",
      client: { messages: { create } } as unknown as ClassifyDeps["client"],
    };
    const res = await classify(
      { description: "   ", rawTranscript: "", photoUrls: [] },
      deps,
    );
    expect(res).toEqual({ urgency: "emergency", confidence: 0, reasoning: "unparseable input" });
    expect(create).not.toHaveBeenCalled();
  });

  it("falls back to emergency/0 when the API throws", async () => {
    const res = await classify(input, clientThrowing());
    expect(res).toEqual({ urgency: "emergency", confidence: 0, reasoning: "unparseable input" });
  });

  it("falls back when the response has no tool_use block", async () => {
    const deps: ClassifyDeps = {
      model: "test-model",
      client: {
        messages: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          create: (async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] })) as any,
        },
      } as ClassifyDeps["client"],
    };
    const res = await classify(input, deps);
    expect(res.urgency).toBe("emergency");
    expect(res.confidence).toBe(0);
  });
});
