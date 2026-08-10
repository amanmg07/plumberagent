import { z } from "zod";

// Inbound message from the (future) messaging provider — normalized to just
// what the agent needs. A real Sendblue/Twilio webhook would be adapted to this
// shape at the edge. Treated as untrusted input.
export const messageInboundSchema = z.object({
  from: z.string().trim().min(5, "from looks too short").max(40),
  // The text body; may be empty when the message is photo-only.
  text: z.string().default(""),
  // URLs of any photos/attachments the homeowner sent this message.
  mediaUrls: z.array(z.string().url("each mediaUrl must be a valid URL")).default([]),
});

export type MessageInboundPayload = z.infer<typeof messageInboundSchema>;
