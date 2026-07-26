import Anthropic from "@anthropic-ai/sdk";

// Shared Anthropic client. Reads ANTHROPIC_API_KEY from the environment (the
// SDK default). Kept in one place so triage and bid-parsing use the same
// configured client and model.
export const anthropic = new Anthropic();

// Default to the most capable model. Override ANTHROPIC_MODEL to trade capability
// for latency/cost on these high-volume paths (see .env.example).
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
