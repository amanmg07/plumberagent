import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "../lib/anthropic.js";
import { log } from "../lib/logger.js";

export type Urgency = "emergency" | "standard";

export interface TriageResult {
  urgency: Urgency;
  confidence: number; // 0-1, the model's self-reported certainty
  reasoning: string;
}

export interface TriageInput {
  description: string;
  rawTranscript: string;
  photoUrls: string[];
}

// Below this confidence we don't trust a classification enough to sit on it.
// We'd rather over-trigger the emergency path (fast dispatch) than let a real
// emergency wait out a 15-minute bid window.
export const CONFIDENCE_THRESHOLD = 0.7;

const SYSTEM_PROMPT = `You are a dispatch triage classifier for a residential plumbing service. \
Given a homeowner's intake (problem description and call transcript), classify the job's urgency.

Classify as "emergency" if ANY of these are present:
- Active water damage or flooding (burst pipe, overflowing fixture, water coming through a ceiling, standing water)
- Smell of gas
- No heat when outdoor temperatures are freezing or below
- No working toilet in a home with only a single bathroom
- Anything else that poses an immediate risk to property or personal safety

Everything else is "standard" — including slow drips, minor leaks that are contained, \
low water pressure, running toilets in multi-bathroom homes, water heater issues that aren't \
actively flooding, cosmetic problems, and routine installs or maintenance.

A panicked or upset tone does NOT by itself make something an emergency — judge by the actual \
described conditions. Likewise, a calm tone does not downgrade a genuine emergency.

Report your certainty as a confidence between 0 and 1. If the transcript is ambiguous, \
contradictory, or missing the details you'd need to be sure, report LOW confidence rather than \
guessing — a downstream rule handles low-confidence cases.`;

const TRIAGE_TOOL: Anthropic.Tool = {
  name: "report_triage",
  description:
    "Report the urgency classification for this plumbing job as structured data.",
  // strict: true guarantees the model's tool input matches this schema exactly,
  // so `urgency` is always one of the two enum values.
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      urgency: {
        type: "string",
        enum: ["emergency", "standard"],
        description: "The urgency classification.",
      },
      confidence: {
        type: "number",
        description:
          "Your certainty in this classification, from 0 (pure guess) to 1 (certain).",
      },
      reasoning: {
        type: "string",
        description:
          "One or two sentences explaining which criteria drove the classification.",
      },
    },
    required: ["urgency", "confidence", "reasoning"],
    additionalProperties: false,
  },
};

// The unparseable/empty fallback. Fail safe toward emergency so we never sit on
// a real emergency because we couldn't understand the input.
const FALLBACK: TriageResult = {
  urgency: "emergency",
  confidence: 0,
  reasoning: "unparseable input",
};

// Pure, testable confidence gate. If the model's confidence is below the
// threshold, force 'emergency' regardless of what it classified. Logs every
// time the gate fires (with the original classification) so we can review how
// often — and how usefully — it triggers.
export function applyConfidenceGate(raw: TriageResult): TriageResult {
  if (raw.confidence >= CONFIDENCE_THRESHOLD) return raw;

  log.warn("triage.low_confidence_override", {
    originalUrgency: raw.urgency,
    confidence: raw.confidence,
    forcedUrgency: "emergency",
    changed: raw.urgency !== "emergency",
    reasoning: raw.reasoning,
  });

  return { ...raw, urgency: "emergency" };
}

// Clamp to [0,1] — strict tool schemas can't enforce numeric bounds, so a model
// could in principle return something out of range.
function clampConfidence(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, v));
}

// Dependencies are injectable so tests can drive classify() without the network.
export interface ClassifyDeps {
  client: Pick<Anthropic, "messages">;
  model: string;
}

const defaultDeps: ClassifyDeps = { client: anthropic, model: MODEL };

// Classify a job's urgency. Never throws — on empty input or any API/parse
// failure it returns the emergency fallback and logs, so a bad intake can't
// crash the dispatch pipeline.
export async function classify(
  input: TriageInput,
  deps: ClassifyDeps = defaultDeps,
): Promise<TriageResult> {
  // Short-circuit obviously empty input before spending an API call.
  if (input.description.trim() === "" && input.rawTranscript.trim() === "") {
    log.warn("triage.empty_input");
    return FALLBACK;
  }

  const userContent =
    `Problem description: ${input.description || "(none provided)"}\n\n` +
    `Call transcript:\n${input.rawTranscript || "(none provided)"}\n\n` +
    `Number of photos attached: ${input.photoUrls.length}`;

  try {
    const response = await deps.client.messages.create({
      model: deps.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [TRIAGE_TOOL],
      // Force the model to answer through the tool so we always get structured
      // output rather than free text.
      tool_choice: { type: "tool", name: TRIAGE_TOOL.name },
      messages: [{ role: "user", content: userContent }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (!toolUse) {
      log.error("triage.no_tool_use", { stopReason: response.stop_reason });
      return FALLBACK;
    }

    const parsed = toolUse.input as {
      urgency?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };

    // strict mode guarantees the enum, but guard anyway before trusting it.
    const urgency: Urgency =
      parsed.urgency === "emergency" || parsed.urgency === "standard"
        ? parsed.urgency
        : "emergency"; // unexpected value → fail safe

    const raw: TriageResult = {
      urgency,
      confidence: clampConfidence(parsed.confidence),
      reasoning:
        typeof parsed.reasoning === "string" && parsed.reasoning.trim() !== ""
          ? parsed.reasoning
          : "(no reasoning provided)",
    };

    return applyConfidenceGate(raw);
  } catch (err) {
    // API error, network failure, malformed response — never propagate.
    log.error("triage.classify_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return FALLBACK;
  }
}
