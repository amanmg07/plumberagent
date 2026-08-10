import "../lib/env.js"; // load .env (harmless); reads no dev flags

// Force the dev flags BEFORE importing anything that reads them at module load
// (db.ts, anthropic.ts). Dynamic imports below pick them up.
process.env.USE_FAKE_DB = "1";
// Use the keyword/regex stub only when no real LLM key is present. Provide a
// GROQ_API_KEY (or ANTHROPIC_API_KEY) to run the agent/classifier for real
// against a fake DB.
if (
  !process.env.GROQ_API_KEY &&
  !process.env.ANTHROPIC_API_KEY &&
  !process.env.OPENAI_COMPAT_API_KEY
) {
  process.env.USE_STUB_LLM = "1";
}
process.env.PORT = process.env.PORT ?? "3000";

const { createApp } = await import("../app.js");
const { prisma } = await import("../db.js");
const { memoryStore } = await import("./memoryPrisma.js");
const { sampleProviders } = await import("./sampleProviders.js");
const { closeExpiredBidWindows } = await import("../bids/close.js");
const { sendSms } = await import("../lib/sms.js");

const port = Number(process.env.PORT);

async function seedProviders() {
  for (const p of sampleProviders) {
    await prisma.provider.create({ data: p });
  }
}

const app = createApp();

// --- Dev-only routes for inspecting and driving the in-memory store ---

// Full snapshot of jobs, bids, providers.
app.get("/dev/state", (_req, res) => {
  res.json(memoryStore.snapshot());
});

// Clear jobs + bids (keep seeded providers) so you can start a fresh scenario.
app.post("/dev/reset", (_req, res) => {
  memoryStore.resetJobsAndBids();
  res.json({ ok: true, message: "jobs and bids cleared; providers kept" });
});

// Force-close every open bidding window now (skips the 15-min wait) so you can
// see the homeowner get quoted without waiting.
app.post("/dev/close-bids", async (_req, res) => {
  const results = await closeExpiredBidWindows({
    prisma: prisma as any,
    sendSms,
    now: () => Date.now() + 10 * 365 * 24 * 3600 * 1000, // far future → all expired
  });
  res.json(results);
});

await seedProviders();

app.listen(port, () => {
  const phones = sampleProviders.map((p) => `${p.phone}  (${p.name})`).join("\n    ");
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
  DEV SERVER (fake DB + stub Claude) on http://localhost:${port}
  Outbound SMS is logged to this console as {"msg":"sms.send",...}
╚══════════════════════════════════════════════════════════════════╝

Seeded providers (use the phone as "From" when simulating a reply):
    ${phones}

── Try the EMERGENCY path ──────────────────────────────────────────
1) Intake an emergency:
   curl -s localhost:${port}/webhooks/intake-complete -H 'content-type: application/json' -d '{
     "homeownerPhone":"+15551230001","description":"pipe burst, water flooding the kitchen",
     "photoUrls":[],"address":"123 Pine St, Seattle WA","rawTranscript":"caller: water everywhere"}'
2) See it dispatched:   curl -s localhost:${port}/dev/state
3) A provider accepts:  curl -s localhost:${port}/webhooks/sms-inbound --data-urlencode 'From=+12065550101' --data-urlencode 'Body=yes'
   (watch this console — the winner gets the address, others get "filled")

── Try the STANDARD auction ────────────────────────────────────────
1) Intake a routine job:
   curl -s localhost:${port}/webhooks/intake-complete -H 'content-type: application/json' -d '{
     "homeownerPhone":"+15551230002","description":"kitchen faucet drips slowly",
     "photoUrls":[],"address":"456 Elm St, Seattle WA","rawTranscript":"caller: minor drip"}'
2) Providers bid:
   curl -s localhost:${port}/webhooks/sms-inbound --data-urlencode 'From=+12065550101' --data-urlencode 'Body=$180, there in 30 min'
   curl -s localhost:${port}/webhooks/sms-inbound --data-urlencode 'From=+12065550102' --data-urlencode 'Body=150 bucks, 45 min'
3) Close the window now:  curl -s -X POST localhost:${port}/dev/close-bids
   (the homeowner is texted the ranked top 3 — see the console)
4) Homeowner picks #1:    curl -s localhost:${port}/webhooks/sms-inbound --data-urlencode 'From=+15551230002' --data-urlencode 'Body=1'

── Try the TEXT-AGENT intake (new) ─────────────────────────────────
The AI agent collects 3 things (issue, photo, address), prompting until it has
them. Same "from" number = same conversation. Watch the "reply" in the response.
1) Homeowner opens with the issue:
   curl -s localhost:${port}/webhooks/message-inbound -H 'content-type: application/json' -d '{"from":"+15557770001","text":"my water heater is leaking all over the garage floor"}'
2) Sends a photo:
   curl -s localhost:${port}/webhooks/message-inbound -H 'content-type: application/json' -d '{"from":"+15557770001","text":"here","mediaUrls":["https://example.com/leak.jpg"]}'
3) Gives the address (completes intake):
   curl -s localhost:${port}/webhooks/message-inbound -H 'content-type: application/json' -d '{"from":"+15557770001","text":"its 789 Maple Ave, Seattle"}'
   -> reply confirms it has everything; conversation status flips to "complete"
(see all collected fields:  curl -s localhost:${port}/dev/state )

Reset anytime:  curl -s -X POST localhost:${port}/dev/reset
`);
});
