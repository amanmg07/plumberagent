import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { log } from "../lib/logger.js";
import { sendMessage } from "../messaging/sendMessage.js";
import { runIntakeTurn } from "../agent/intakeAgent.js";
import { messageInboundSchema } from "./messageInbound.schema.js";

// A normalized inbound message, whatever channel it came from.
export interface InboundMessage {
  from: string;
  text: string;
  mediaUrls: string[];
}

export interface TurnOutcome {
  conversationId: string;
  status: string;
  collected: { description: boolean; photos: number; address: boolean };
  reply: string;
}

// Core: one homeowner message (+ optional photos) -> one agent turn. Channel-
// agnostic — does NOT send the reply (the caller decides how: sendMessage for
// the JSON/dev path, TwiML for Twilio WhatsApp). Tracks the three objectives and
// completes the conversation when all are collected (handoff wired later).
export async function runConversationTurn(msg: InboundMessage): Promise<TurnOutcome> {
  const { from, text, mediaUrls } = msg;

  const existing = await prisma.conversation.findFirst({
    where: { homeownerPhone: from, status: "collecting" },
    orderBy: { createdAt: "desc" },
  });
  const convo =
    existing ??
    (await prisma.conversation.create({ data: { homeownerPhone: from } }));

  const photoUrls = [...convo.photoUrls, ...mediaUrls];

  const turn = await runIntakeTurn(
    { description: convo.description, photoCount: photoUrls.length, address: convo.address },
    text,
    mediaUrls.length > 0,
  );

  const description = turn.description ?? convo.description;
  const address = turn.address ?? convo.address;
  const complete = !!description && photoUrls.length > 0 && !!address;

  const transcript =
    convo.transcript +
    `Homeowner: ${text}${mediaUrls.length > 0 ? ` [${mediaUrls.length} photo(s)]` : ""}\n` +
    `Agent: ${turn.reply}\n`;

  const updated = await prisma.conversation.update({
    where: { id: convo.id },
    data: {
      description,
      address,
      photoUrls,
      transcript,
      status: complete ? "complete" : "collecting",
      completedAt: complete ? new Date() : null,
    },
  });

  log.info("message_inbound.turn", {
    conversationId: updated.id,
    status: updated.status,
    have: { description: !!description, photos: photoUrls.length, address: !!address },
  });

  return {
    conversationId: updated.id,
    status: updated.status,
    collected: { description: !!description, photos: photoUrls.length, address: !!address },
    reply: turn.reply,
  };
}

// POST /webhooks/message-inbound
// JSON channel (used by the dev server / curl). Runs a turn, sends the reply via
// the sendMessage seam, and returns the outcome as JSON.
export async function messageInboundHandler(req: Request, res: Response) {
  log.info("message_inbound.received", { body: req.body });

  const parsed = messageInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("message_inbound.validation_failed", { issues: parsed.error.issues });
    return res.status(400).json({
      error: "validation_failed",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }

  const outcome = await runConversationTurn(parsed.data);
  await sendMessage(parsed.data.from, outcome.reply);

  return res.status(200).json(outcome);
}
