import { log } from "../lib/logger.js";

// The single seam for outbound messages to the homeowner (the AI agent's
// replies). Swap the body for a real provider later — iMessage via
// Sendblue/LoopMessage/BlueBubbles, or SMS/MMS via Twilio — the signature stays
// the same, so the agent code doesn't change.
export async function sendMessage(to: string, text: string): Promise<void> {
  // For now, just log it so the conversation can be watched end to end.
  log.info("message.send", { to, text });
}
