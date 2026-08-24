/**
 * Structured logging for critical flows: auth, payment, enrolment activation.
 *
 * One JSON object per line so Vercel's log drains (and `vercel logs`) stay queryable.
 * `AuditLog` records *who did what* for the school's own records; this records *what the
 * system did* for operators — including the failures that never reach the audit table,
 * such as a rejected login or a payment-gateway misconfiguration.
 *
 * Never pass passwords, password hashes, JWTs, reset tokens, or gateway secret keys.
 * Identify people by `loginId` or `userId`, never by credential.
 */

export type LogCategory = "auth" | "payment" | "activation" | "config";
type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: Level, category: LogCategory, event: string, fields: Fields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    category,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (category: LogCategory, event: string, fields?: Fields) => emit("info", category, event, fields),
  warn: (category: LogCategory, event: string, fields?: Fields) => emit("warn", category, event, fields),
  error: (category: LogCategory, event: string, fields?: Fields) => emit("error", category, event, fields),
};

/** Narrow an unknown thrown value to a message safe to log. */
export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
