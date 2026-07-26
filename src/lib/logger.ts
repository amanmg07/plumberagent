// Minimal structured logger. Emits one JSON object per line to stdout so logs
// are greppable and machine-parseable in aggregators (Datadog, CloudWatch,
// etc.) without pulling in a logging framework yet. Swap for pino later if
// volume warrants it — call sites just use log.info/warn/error.

type Level = "info" | "warn" | "error";

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const line = {
    level,
    msg,
    // Caller-supplied timestamp so this stays deterministic in tests that
    // inject a clock; falls back to now() in normal operation.
    ts: new Date().toISOString(),
    ...fields,
  };
  const out = JSON.stringify(line);
  if (level === "error") process.stderr.write(out + "\n");
  else process.stdout.write(out + "\n");
}

export const log = {
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
