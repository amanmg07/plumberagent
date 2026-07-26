import { log } from "./logger.js";

// The single seam for outbound SMS. Everything that texts a provider or
// homeowner goes through here. Swap the body for the real Twilio call later
// (client.messages.create({ to, from, body })) — the signature stays the same,
// so nothing upstream changes.
export async function sendSms(to: string, body: string): Promise<void> {
  // For now, just log it so you can watch the dispatch flow end to end without
  // sending anything.
  log.info("sms.send", { to, body });
}
