import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { log } from "../lib/logger.js";
import { geocode } from "../lib/geocode.js";
import { classify } from "../triage/classify.js";
import { dispatch } from "../dispatch/dispatch.js";
import { intakeSchema } from "./intake.schema.js";

// POST /webhooks/intake-complete
// Entry point for a completed voice-agent intake. Persists a 'posted' Job with
// urgency still null (triage runs later). Returns 202 — accepted, not done.
export async function intakeCompleteHandler(req: Request, res: Response) {
  // 1. Log the raw payload FIRST, before validation or anything that can throw.
  //    If a later step blows up, the intake is still recoverable from logs.
  log.info("intake.received", { body: req.body });

  // 2. Validate. On failure return 400 with the specific issues — never drop
  //    bad data silently.
  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) {
    log.warn("intake.validation_failed", {
      issues: parsed.error.issues,
      body: req.body,
    });
    return res.status(400).json({
      error: "validation_failed",
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  const payload = parsed.data;

  // 3. Geocode the address to coarse lat/lng for matching. Stubbed for now.
  //    A null result (unresolvable address) is stored as null lat/lng rather
  //    than failing the intake — dispatch can flag it downstream.
  const point = await geocode(payload.address);

  // 4. Persist the job. status 'posted', urgency null (not yet classified).
  const job = await prisma.job.create({
    data: {
      homeownerPhone: payload.homeownerPhone,
      category: "plumbing", // single vertical in the pilot
      description: payload.description,
      photoUrls: payload.photoUrls,
      address: payload.address,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      urgency: null,
      status: "posted",
      rawTranscript: payload.rawTranscript,
    },
  });

  log.info("intake.job_created", { jobId: job.id });

  // 5. Classify urgency (step 3). classify() never throws — it fails safe to
  //    'emergency' on error — so this can't sink the intake. We persist the
  //    result but do NOT dispatch yet (that's step 4).
  const triage = await classify({
    description: payload.description,
    rawTranscript: payload.rawTranscript,
    photoUrls: payload.photoUrls,
  });

  const triagedJob = await prisma.job.update({
    where: { id: job.id },
    data: {
      urgency: triage.urgency,
      triageConfidence: triage.confidence,
      triageReasoning: triage.reasoning,
    },
  });

  log.info("intake.triaged", {
    jobId: job.id,
    urgency: triage.urgency,
    confidence: triage.confidence,
  });

  // 6. Dispatch (step 4). Route on urgency: emergency → nearest-verified SMS
  //    race; standard → open a 15-minute sealed-bid window. Wrapped so a
  //    dispatch failure can't undo an intake we've already accepted — the job
  //    is stored and can be re-dispatched.
  try {
    await dispatch(triagedJob);
  } catch (err) {
    log.error("intake.dispatch_failed", {
      jobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 7. 202 Accepted — intake stored, classified, and dispatch kicked off.
  return res.status(202).json({ jobId: job.id, status: "received" });
}
