import type { Request, Response } from "express";
import { log } from "../lib/logger.js";
import { runConversationTurn } from "./messageInbound.js";

// Escape text for inclusion in a TwiML XML body.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
}

// POST /webhooks/whatsapp
// Twilio's WhatsApp inbound webhook (form-encoded). Twilio sends the homeowner's
// message here; we run one agent turn and reply with TwiML — Twilio delivers
// that reply straight back to WhatsApp, so no outbound API credentials are
// needed. Great for the Twilio WhatsApp Sandbox.
//
// Twilio fields: From = "whatsapp:+1555...", Body = text, NumMedia = "N",
// MediaUrl0..MediaUrl{N-1} = attachment URLs.
export async function whatsappHandler(req: Request, res: Response) {
  log.info("whatsapp.received", { body: req.body });

  const rawFrom: string = req.body?.From ?? "";
  const from = rawFrom.replace(/^whatsapp:/, "").trim();
  const text: string = req.body?.Body ?? "";

  const numMedia = Number.parseInt(req.body?.NumMedia ?? "0", 10) || 0;
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = req.body?.[`MediaUrl${i}`];
    if (typeof url === "string" && url) mediaUrls.push(url);
  }

  if (from === "") {
    log.warn("whatsapp.missing_from");
    // Still 200 so Twilio doesn't retry; nothing to reply to.
    return res.status(200).type("text/xml").send("<Response></Response>");
  }

  try {
    const outcome = await runConversationTurn({ from, text, mediaUrls });
    log.info("whatsapp.replied", { from, status: outcome.status });
    return res.status(200).type("text/xml").send(twiml(outcome.reply));
  } catch (err) {
    log.error("whatsapp.turn_failed", {
      from,
      error: err instanceof Error ? err.message : String(err),
    });
    // Reply with a graceful message rather than failing the webhook.
    return res
      .status(200)
      .type("text/xml")
      .send(twiml("Sorry, something went wrong on our end. Please try again in a moment."));
  }
}
