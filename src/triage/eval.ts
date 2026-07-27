import "../lib/env.js"; // must be first — loads .env before the LLM client
import { classify } from "./classify.js";
import { LLM_PROVIDER, MODEL } from "../lib/anthropic.js";
import { fixtures } from "./fixtures.js";

// Run every fixture through classify() against a real LLM, print a comparison
// table, and report accuracy — with special attention to emergencies
// misclassified as standard (a false negative here means a real emergency would
// go into a 15-minute auction instead of being dispatched).
//
// Providers (set one before running):
//   ANTHROPIC_API_KEY=...  -> Claude (what you'd ship; most representative)
//   GROQ_API_KEY=...       -> Groq free tier (tests that model's judgment, not Claude's)
// Exits 1 if ANY expected-emergency fixture is classified 'standard', so this
// can gate CI later.

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main() {
  // Only the default Claude path needs a key we can check up front; the other
  // providers are selected because their key is already present.
  if (LLM_PROVIDER === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      "No LLM credential found. Set ANTHROPIC_API_KEY (Claude), or GROQ_API_KEY for a free model, then re-run.",
    );
    process.exit(2);
  }

  console.log(
    `\nRunning ${fixtures.length} triage fixtures  |  provider: ${LLM_PROVIDER}  model: ${MODEL}\n`,
  );
  if (LLM_PROVIDER !== "anthropic") {
    console.log(
      `NOTE: this measures ${LLM_PROVIDER}'s judgment, not the Claude model you'd ship.\n`,
    );
  }

  console.log(
    `${pad("id", 26)} ${pad("expected", 10)} ${pad("actual", 10)} ${pad("conf", 6)} ${pad("ok", 4)}`,
  );
  console.log("-".repeat(64));

  let correct = 0;
  let emergencyTotal = 0;
  let emergencyFalseNegatives = 0;
  const falseNegativeIds: string[] = [];

  // Run sequentially to keep output readable and avoid hammering rate limits.
  for (const f of fixtures) {
    const result = await classify(f.input);
    const ok = result.urgency === f.label;
    if (ok) correct++;

    if (f.label === "emergency") {
      emergencyTotal++;
      if (result.urgency === "standard") {
        emergencyFalseNegatives++;
        falseNegativeIds.push(f.id);
      }
    }

    console.log(
      `${pad(f.id, 26)} ${pad(f.label, 10)} ${pad(result.urgency, 10)} ` +
        `${pad(result.confidence.toFixed(2), 6)} ${pad(ok ? "✓" : "✗", 4)}`,
    );
  }

  const accuracy = (correct / fixtures.length) * 100;
  const fnRate =
    emergencyTotal === 0 ? 0 : (emergencyFalseNegatives / emergencyTotal) * 100;

  console.log("\n" + "=".repeat(64));
  console.log(
    `Overall accuracy:        ${correct}/${fixtures.length} (${accuracy.toFixed(1)}%)`,
  );
  console.log(
    `Emergency fixtures:      ${emergencyTotal}  (the ones that must not be missed)`,
  );

  if (emergencyFalseNegatives === 0) {
    console.log(
      `Emergency false-neg rate: 0.0%  ✓  no emergency was classified as standard`,
    );
  } else {
    console.log(
      `\n🚨 EMERGENCY FALSE-NEGATIVE RATE: ${fnRate.toFixed(1)}% ` +
        `(${emergencyFalseNegatives}/${emergencyTotal})`,
    );
    console.log(
      `🚨 These emergencies were classified as standard: ${falseNegativeIds.join(", ")}`,
    );
    console.log(
      `🚨 This is the number that matters most — investigate before shipping.`,
    );
  }
  console.log("=".repeat(64) + "\n");

  // Gate: any missed emergency fails the run.
  process.exit(emergencyFalseNegatives > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("eval crashed:", err);
  process.exit(2);
});
