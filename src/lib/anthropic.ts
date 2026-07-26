import Anthropic from "@anthropic-ai/sdk";
import { makeStubAnthropic } from "../dev/stubLlm.js";

// Shared Anthropic client. Reads ANTHROPIC_API_KEY from the environment (the
// SDK default). Kept in one place so triage and bid-parsing use the same
// configured client and model.
//
// Dev affordance: with USE_STUB_LLM=1 (see `npm run dev:fake`) triage and bid
// parsing run against a deterministic keyword/regex stub instead of the real
// API — no key needed. Production leaves the flag unset.
export const anthropic =
  process.env.USE_STUB_LLM === "1"
    ? (makeStubAnthropic() as unknown as Anthropic)
    : new Anthropic();

// Default to the most capable model. Override ANTHROPIC_MODEL to trade capability
// for latency/cost on these high-volume paths (see .env.example).
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
