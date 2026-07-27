import Anthropic from "@anthropic-ai/sdk";
import { makeStubAnthropic } from "../dev/stubLlm.js";
import { makeOpenAICompatClient } from "./openaiCompat.js";

// Selects the LLM client + model from the environment. Production leaves all the
// flags below unset and gets the real Claude client. The other branches are for
// dev/testing only:
//   USE_STUB_LLM=1   -> deterministic keyword stub (npm run dev:fake), no key
//   GROQ_API_KEY     -> Groq's free OpenAI-compatible endpoint
//   OPENAI_COMPAT_*  -> any other OpenAI-compatible provider (OpenRouter, ...)
function selectLlm() {
  if (process.env.USE_STUB_LLM === "1") {
    return { provider: "stub", client: makeStubAnthropic(), model: "stub" };
  }
  if (process.env.GROQ_API_KEY) {
    return {
      provider: "groq",
      client: makeOpenAICompatClient({
        baseUrl: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY,
      }),
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    };
  }
  if (process.env.OPENAI_COMPAT_API_KEY && process.env.OPENAI_COMPAT_BASE_URL) {
    return {
      provider: "openai-compat",
      client: makeOpenAICompatClient({
        baseUrl: process.env.OPENAI_COMPAT_BASE_URL,
        apiKey: process.env.OPENAI_COMPAT_API_KEY,
      }),
      model: process.env.OPENAI_COMPAT_MODEL ?? "",
    };
  }
  return {
    provider: "anthropic",
    client: new Anthropic(),
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
  };
}

const selected = selectLlm();

// Which provider is active — exposed so the eval can report it and gate on it.
export const LLM_PROVIDER = selected.provider;

// Shared client, used by triage and bid-parsing. Typed as Anthropic; the
// dev/OpenAI-compat clients present the same messages.create surface.
export const anthropic = selected.client as unknown as Anthropic;

export const MODEL = selected.model;
