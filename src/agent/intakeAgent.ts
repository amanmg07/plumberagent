import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "../lib/anthropic.js";
import { log } from "../lib/logger.js";

// What we know so far in the conversation.
export interface IntakeState {
  description: string | null;
  photoCount: number;
  address: string | null;
}

// One turn's output: any newly-extracted fields (null = nothing new, keep
// existing) plus the reply to send back.
export interface IntakeTurnResult {
  description: string | null;
  address: string | null;
  reply: string;
}

const SYSTEM_PROMPT = `You are a friendly, concise assistant collecting intake for a plumbing service over \
text message. You must gather exactly THREE things from the homeowner:
  1. A short summary of the plumbing issue (e.g. "leak under the kitchen sink", "no hot water").
  2. At least one photo of the issue.
  3. The service address.

You are told what has already been collected and whether the latest message included a photo. Do two things:

- EXTRACT: if the homeowner's latest message provides the issue summary or the address (or clarifies/\
corrects one), return it. If they didn't provide something new for a field, return null for that field — \
do not repeat or invent values. You do not handle photos here; whether a photo was received is tracked for you.

- REPLY: write a short, warm, text-message-style reply (1-3 sentences). Acknowledge what they just gave, \
then ask for whatever is still missing — at most one or two items at a time, don't overwhelm them. If all \
three objectives are now collected, do NOT ask for more: thank them and tell them a plumber will be in \
touch shortly. If the issue summary is still vague, ask a brief clarifying question instead of accepting it.`;

const TURN_TOOL: Anthropic.Tool = {
  name: "intake_turn",
  description: "Report extracted intake fields and the reply to send the homeowner.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      description: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Newly provided issue summary, or null if the message added nothing new.",
      },
      address: {
        anyOf: [{ type: "string" }, { type: "null" }],
        description: "Newly provided service address, or null if the message added nothing new.",
      },
      reply: {
        type: "string",
        description: "The text-message reply to send the homeowner.",
      },
    },
    required: ["description", "address", "reply"],
    additionalProperties: false,
  },
};

export interface IntakeAgentDeps {
  client: Pick<Anthropic, "messages">;
  model: string;
}

const defaultDeps: IntakeAgentDeps = { client: anthropic, model: MODEL };

// A safe fallback reply if the model call fails — keep the conversation alive.
const FALLBACK: IntakeTurnResult = {
  description: null,
  address: null,
  reply:
    "Sorry, I didn't quite catch that. Could you tell me what the plumbing issue is, send a photo, and share the address?",
};

// Run one conversation turn. Never throws — a model hiccup returns a safe reply
// rather than dropping the homeowner.
export async function runIntakeTurn(
  state: IntakeState,
  userText: string,
  photoAttachedThisMessage: boolean,
  deps: IntakeAgentDeps = defaultDeps,
): Promise<IntakeTurnResult> {
  const userContent =
    `Current issue summary: ${state.description ?? "(none yet)"}\n` +
    `Photos received so far: ${state.photoCount}\n` +
    `Current address: ${state.address ?? "(none yet)"}\n` +
    `Photo attached in this message: ${photoAttachedThisMessage ? "yes" : "no"}\n` +
    `The homeowner just texted: ${JSON.stringify(userText)}`;

  try {
    const response = await deps.client.messages.create({
      model: deps.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [TURN_TOOL],
      tool_choice: { type: "tool", name: TURN_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      log.warn("agent.no_tool_use");
      return FALLBACK;
    }

    const parsed = toolUse.input as {
      description?: unknown;
      address?: unknown;
      reply?: unknown;
    };

    const description =
      typeof parsed.description === "string" && parsed.description.trim() !== ""
        ? parsed.description
        : null;
    const address =
      typeof parsed.address === "string" && parsed.address.trim() !== ""
        ? parsed.address
        : null;
    const reply =
      typeof parsed.reply === "string" && parsed.reply.trim() !== ""
        ? parsed.reply
        : FALLBACK.reply;

    return { description, address, reply };
  } catch (err) {
    log.error("agent.turn_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK;
  }
}
