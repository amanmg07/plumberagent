import { z } from "zod";

// Payload handed to us by the hosted voice agent once it finishes intake.
// Treated as UNTRUSTED input — every field is validated before we touch the DB.
export const intakeSchema = z.object({
  // E.164-ish. We don't hard-validate carrier format here (Twilio does that
  // upstream), but we reject empty/whitespace and absurd lengths.
  homeownerPhone: z
    .string()
    .trim()
    .min(7, "homeownerPhone looks too short")
    .max(20, "homeownerPhone looks too long"),
  description: z.string().trim().min(1, "description is required"),
  // Each photo URL must be a real http(s) URL. Empty array is allowed — a
  // homeowner may not have sent photos.
  photoUrls: z
    .array(z.string().url("each photoUrl must be a valid URL"))
    .max(20, "too many photoUrls"),
  address: z.string().trim().min(1, "address is required"),
  rawTranscript: z.string().min(1, "rawTranscript is required"),
});

export type IntakePayload = z.infer<typeof intakeSchema>;
