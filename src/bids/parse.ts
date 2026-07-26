import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "../lib/anthropic.js";
import { log } from "../lib/logger.js";

// Parsed bid, in the shape the Bid table stores (camelCase, matching Prisma).
export interface ParsedBid {
  priceCents: number;
  etaMinutes: number; // minutes from the reference "now" until arrival
}

const SYSTEM_PROMPT = `You extract structured bids from plumbers' text-message replies to a job offer.

A valid bid needs BOTH a concrete price AND a concrete arrival time/ETA. Examples:
- "$180, there by 3pm"     -> price 18000 cents, eta = minutes from the current time until 3pm
- "can do it for 220, 45 min out" -> price 22000 cents, eta 45
- "one fifty, arrive around 2:30" -> price 15000 cents, eta = minutes until 2:30

Rules:
- price_cents is the dollar amount in cents ($180 -> 18000). Ignore currency symbols and words.
- eta_minutes is how many minutes from the CURRENT TIME (given in the message) until they arrive. \
Convert clock times ("3pm", "2:30") into minutes from the current time. Relative phrasing \
("in 45 minutes", "half an hour") converts directly.
- Set parseable to false, with price_cents and eta_minutes null, if the message is NOT a genuine \
bid — e.g. a question, a decline, small talk, gibberish, or missing either the price or the ETA. \
Do not guess a price or a time that isn't there.`;

const BID_TOOL: Anthropic.Tool = {
  name: "report_bid",
  description: "Report the structured bid extracted from a provider's SMS reply.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      parseable: {
        type: "boolean",
        description:
          "true only if the message contains BOTH a concrete price and a concrete ETA.",
      },
      price_cents: {
        // Nullable: strict mode forces a tool call even on non-bids, so the
        // model signals "no price" with null rather than inventing one.
        anyOf: [{ type: "integer" }, { type: "null" }],
        description: "Price in cents (e.g. $180 -> 18000), or null if not stated.",
      },
      eta_minutes: {
        anyOf: [{ type: "integer" }, { type: "null" }],
        description:
          "Minutes from the current time until arrival, or null if not stated.",
      },
    },
    required: ["parseable", "price_cents", "eta_minutes"],
    additionalProperties: false,
  },
};

export interface ParseBidDeps {
  client: Pick<Anthropic, "messages">;
  model: string;
  now: () => number; // reference time for converting clock ETAs; injectable
}

const defaultDeps: ParseBidDeps = {
  client: anthropic,
  model: MODEL,
  now: () => Date.now(),
};

// Parse a provider's raw SMS reply into { priceCents, etaMinutes }. Returns null
// (and logs) for anything that isn't a genuine bid, and never throws — a bad
// text from one provider must not break the bidding round for the others.
export async function parseBid(
  rawText: string,
  deps: ParseBidDeps = defaultDeps,
): Promise<ParsedBid | null> {
  if (rawText.trim() === "") {
    log.warn("bid.empty_input");
    return null;
  }

  // Give the model a concrete reference time so it can turn "3pm" into minutes.
  const nowIso = new Date(deps.now()).toISOString();
  const userContent =
    `Current time: ${nowIso} (timezone America/Los_Angeles).\n` +
    `Provider's SMS reply: ${JSON.stringify(rawText)}`;

  try {
    const response = await deps.client.messages.create({
      model: deps.model,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      tools: [BID_TOOL],
      tool_choice: { type: "tool", name: BID_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      log.warn("bid.no_tool_use", { rawText });
      return null;
    }

    const parsed = toolUse.input as {
      parseable?: unknown;
      price_cents?: unknown;
      eta_minutes?: unknown;
    };

    if (parsed.parseable !== true) {
      log.info("bid.unparseable", { rawText });
      return null;
    }

    const priceCents = parsed.price_cents;
    const etaMinutes = parsed.eta_minutes;

    // Even with parseable=true, validate before trusting the numbers: a price
    // must be a positive integer, an ETA a non-negative integer.
    const priceOk = typeof priceCents === "number" && Number.isInteger(priceCents) && priceCents > 0;
    const etaOk = typeof etaMinutes === "number" && Number.isInteger(etaMinutes) && etaMinutes >= 0;

    if (!priceOk || !etaOk) {
      log.warn("bid.invalid_values", { rawText, priceCents, etaMinutes });
      return null;
    }

    return { priceCents, etaMinutes };
  } catch (err) {
    log.error("bid.parse_failed", {
      rawText,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
