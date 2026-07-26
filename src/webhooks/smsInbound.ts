import type { Request, Response } from "express";
import { log } from "../lib/logger.js";
import { routeInboundSms } from "../inbound/router.js";
import { smsInboundSchema } from "./smsInbound.schema.js";

// Empty TwiML — we acknowledge the webhook and send any replies via the SMS
// API (sendSms) rather than in the webhook response.
const EMPTY_TWIML = "<Response></Response>";

// POST /webhooks/sms-inbound
// Twilio's inbound-SMS webhook. Routes provider/homeowner replies to the right
// handler based on who sent it and the state of their job.
export async function smsInboundHandler(req: Request, res: Response) {
  log.info("sms_inbound.received", { body: req.body });

  const parsed = smsInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("sms_inbound.validation_failed", { issues: parsed.error.issues });
    return res.status(400).type("text/xml").send(EMPTY_TWIML);
  }

  // Always ack with 200 so Twilio doesn't retry-storm on an internal hiccup —
  // routing failures are logged for follow-up, not surfaced to the carrier.
  try {
    const outcome = await routeInboundSms(parsed.data.From, parsed.data.Body);
    log.info("sms_inbound.routed", { from: parsed.data.From, kind: outcome.kind });
  } catch (err) {
    log.error("sms_inbound.route_failed", {
      from: parsed.data.From,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return res.status(200).type("text/xml").send(EMPTY_TWIML);
}
