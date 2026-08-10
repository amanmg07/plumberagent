import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { log } from "../lib/logger.js";
import { sendMessage } from "../messaging/sendMessage.js";
import { runIntakeTurn } from "../agent/intakeAgent.js";
import { messageInboundSchema } from "./messageInbound.schema.js";

// POST /webhooks/message-inbound
// One homeowner text (+ optional photos) -> one agent turn. The agent extracts
// what it can, we track the three objectives, and it replies asking for
// whatever's still missing. When all three are collected the conversation is
// marked complete (handoff to /webhooks/intake-complete wired later).
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

  const { from, text, mediaUrls } = parsed.data;

  // Find the homeowner's in-progress conversation, or start a fresh one.
  const existing = await prisma.conversation.findFirst({
    where: { homeownerPhone: from, status: "collecting" },
    orderBy: { createdAt: "desc" },
  });
  const convo =
    existing ??
    (await prisma.conversation.create({ data: { homeownerPhone: from } }));

  // Fold in any photos from this message before running the turn.
  const photoUrls = [...convo.photoUrls, ...mediaUrls];

  const turn = await runIntakeTurn(
    {
      description: convo.description,
      photoCount: photoUrls.length,
      address: convo.address,
    },
    text,
    mediaUrls.length > 0,
  );

  // Merge: keep existing values unless the turn extracted new ones.
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

  await sendMessage(from, turn.reply);

  log.info("message_inbound.turn", {
    conversationId: updated.id,
    status: updated.status,
    have: { description: !!description, photos: photoUrls.length, address: !!address },
  });

  return res.status(200).json({
    conversationId: updated.id,
    status: updated.status,
    collected: { description: !!description, photos: photoUrls.length, address: !!address },
    reply: turn.reply,
  });
}
