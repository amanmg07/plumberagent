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

// Stub for the intake agent turn. Parses the labeled state the agent embeds in
// the user message, does crude extraction from the latest text, and writes a
// reply asking for whatever's still missing. Dumb but functional — lets the
// whole conversation be driven by curl with no API key.
function intakeTurn(text: string) {
  const summary = text.match(/Current issue summary: (.*)/)?.[1]?.trim() ?? "(none yet)";
  const addr = text.match(/Current address: (.*)/)?.[1]?.trim() ?? "(none yet)";
  const photos = Number.parseInt(text.match(/Photos received so far: (\d+)/)?.[1] ?? "0", 10);
  let said = "";
  const saidM = text.match(/The homeowner just texted: ([\s\S]*)$/);
  if (saidM) {
    try {
      said = JSON.parse(saidM[1].trim());
    } catch {
      said = saidM[1].trim();
    }
  }

  const hasDesc = summary !== "(none yet)" && summary !== "";
  const hasAddr = addr !== "(none yet)" && addr !== "";

  const ISSUE_WORDS = /leak|clog|drip|burst|toilet|sink|water|pipe|heater|drain|flood|faucet|shower|tub|sewage|backed up|no hot/i;
  const ADDRESS_RE = /\d{1,6}\s+[\w.\s]+?\b(st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|ct|court|pl|place)\b[\w.\s,]*/i;

  let newDescription: string | null = null;
  if (!hasDesc && ISSUE_WORDS.test(said) && said.trim().length > 8) {
    newDescription = said.trim();
  }
  let newAddress: string | null = null;
  const am = said.match(ADDRESS_RE);
  if (!hasAddr && am) newAddress = am[0].trim();

  const haveDesc = hasDesc || !!newDescription;
  const haveAddr = hasAddr || !!newAddress;
  const havePhotos = photos > 0;

  const missing: string[] = [];
  if (!haveDesc) missing.push("a quick description of the issue");
  if (!havePhotos) missing.push("a photo of the problem");
  if (!haveAddr) missing.push("the service address");

  let reply: string;
  if (missing.length === 0) {
    reply = "Perfect — I've got the issue, a photo, and your address. A plumber will reach out shortly. Thanks!";
  } else {
    const list =
      missing.length === 1
        ? missing[0]
        : missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1];
    reply = `Thanks! Could you also send ${list}?`;
  }

  return { description: newDescription, address: newAddress, reply };
}

function respond(params: any) {
  const toolName = params.tool_choice?.name ?? params.tools?.[0]?.name;
  const userText = String(params.messages?.[0]?.content ?? "");

  let input: any;
  if (toolName === "report_triage") input = triage(userText);
  else if (toolName === "report_bid") input = parseBidHeuristic(userText);
  else if (toolName === "intake_turn") input = intakeTurn(userText);
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
