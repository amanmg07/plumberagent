import { z } from "zod";

// Twilio posts inbound SMS as application/x-www-form-urlencoded. We only need
// From (sender) and Body (message text); the rest of Twilio's fields are ignored.
export const smsInboundSchema = z.object({
  From: z.string().trim().min(7, "From looks too short").max(20),
  Body: z.string(), // may be empty; the router decides what to do with it
});

export type SmsInboundPayload = z.infer<typeof smsInboundSchema>;
