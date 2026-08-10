import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { log } from "./lib/logger.js";
import { intakeCompleteHandler } from "./webhooks/intake.js";
import { smsInboundHandler } from "./webhooks/smsInbound.js";
import { messageInboundHandler } from "./webhooks/messageInbound.js";

// Express 4 doesn't forward rejected promises from async handlers to error
// middleware — wrap them so a thrown/rejected handler becomes a 500 instead of
// a hung request.
const asyncHandler =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// App factory — returns a configured Express app without binding a port, so
// tests can drive it via supertest and server.ts can listen() on it.
export function createApp() {
  const app = express();

  app.use(express.json({ limit: "1mb" }));
  // Twilio posts inbound SMS as form-encoded.
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.post("/webhooks/intake-complete", asyncHandler(intakeCompleteHandler));
  app.post("/webhooks/sms-inbound", asyncHandler(smsInboundHandler));
  app.post("/webhooks/message-inbound", asyncHandler(messageInboundHandler));

  // Malformed JSON bodies land here as a SyntaxError from express.json().
  // Return a clean 400 rather than a 500 stack trace.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && "body" in (err as any)) {
      log.warn("http.bad_json", { path: req.path });
      return res.status(400).json({ error: "malformed_json" });
    }
    log.error("http.unhandled_error", {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: "internal_error" });
  });

  return app;
}
