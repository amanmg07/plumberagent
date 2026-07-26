// A deterministic stand-in for the Claude client, active only when
// USE_STUB_LLM=1. It returns the same tool_use structured-output shape the real
// API would, using simple keyword/regex heuristics — enough to make the dev
// flow behave sensibly (an emergency-sounding intake routes to the emergency
// path; "$180, 30 min" parses into a bid). It is NOT a real classifier — the
// eval against a real model is still the thing that validates judgment.

function triage(text: string) {
  const t = text.toLowerCase();
  const emergencySignals = [
    "flood",
    "burst",
    "gas",
    "no heat",
    "freezing",
    "sewage",
    "pouring",
    "spraying",
    "overflow",
    "ceiling",
    "water everywhere",
    "no working toilet",
    "single bathroom",
  ];
  const hit = emergencySignals.find((s) => t.includes(s));
  return hit
    ? { urgency: "emergency", confidence: 0.95, reasoning: `stub: matched "${hit}"` }
    : { urgency: "standard", confidence: 0.9, reasoning: "stub: no emergency indicators" };
}

function parseBidHeuristic(text: string) {
  // The prompt embeds the reply as: Provider's SMS reply: "<raw>"
  const m = text.match(/reply:\s*(.*)$/s);
  const reply = m ? m[1] : text;

  const priceM = reply.match(/\$?\s*(\d{2,4})(?:\.\d{2})?/);
  const minM = reply.match(/(\d+)\s*min/i);
  const clockM = reply.match(/\b(\d{1,2})(:\d{2})?\s*(am|pm)\b/i);

  const priceCents = priceM ? Number.parseInt(priceM[1], 10) * 100 : null;
  const etaMinutes = minM ? Number.parseInt(minM[1], 10) : clockM ? 45 : null;

  if (priceCents != null && etaMinutes != null) {
    return { parseable: true, price_cents: priceCents, eta_minutes: etaMinutes };
  }
  return { parseable: false, price_cents: null, eta_minutes: null };
}

function respond(params: any) {
  const toolName = params.tool_choice?.name ?? params.tools?.[0]?.name;
  const userText = String(params.messages?.[0]?.content ?? "");

  let input: any;
  if (toolName === "report_triage") input = triage(userText);
  else if (toolName === "report_bid") input = parseBidHeuristic(userText);
  else input = {};

  return {
    id: "stub_msg",
    type: "message",
    role: "assistant",
    model: params.model,
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "stub_tool", name: toolName, input }],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

export function makeStubAnthropic() {
  return {
    messages: {
      create: async (params: any) => respond(params),
    },
  };
}
