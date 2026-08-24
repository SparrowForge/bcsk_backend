/**
 * The error taxonomy shared by every delivery surface.
 *
 * A service throws `AppError` with a stable machine-readable code. The HTTP layer maps that
 * code to a status; a Server Action maps it to a user-facing message. Neither surface invents
 * its own error semantics, so a rule enforced in a service behaves identically whether it was
 * reached from a web form or a mobile app.
 *
 * Framework-free: no next/*, no HTTP types. `httpStatusFor` returns a plain number.
 */

export const ERROR_CODES = {
  /** Input failed schema validation. `details` carries per-field messages. */
  VALIDATION_FAILED: "VALIDATION_FAILED",
  /** No credential, or a credential that no longer verifies. */
  UNAUTHENTICATED: "UNAUTHENTICATED",
  /** Authenticated, but the actor lacks the required capability. */
  FORBIDDEN: "FORBIDDEN",
  /** Absent — or present but deliberately hidden from this actor. */
  NOT_FOUND: "NOT_FOUND",
  /** The request contradicts current state: duplicate payment, already-activated application. */
  CONFLICT: "CONFLICT",
  /** Well-formed and permitted, but rejected by a business rule. */
  UNPROCESSABLE: "UNPROCESSABLE",
  /** Throttled. Carries `retryAfterSeconds`. */
  RATE_LIMITED: "RATE_LIMITED",
  /** Our configuration is wrong — not the caller's fault. Never blame the user for these. */
  MISCONFIGURED: "MISCONFIGURED",
  /** A third party we depend on failed or was unreachable. */
  UPSTREAM_FAILED: "UPSTREAM_FAILED",
  /** Anything unclassified. The message is never shown to the caller. */
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  // Both of these are our fault, so they must not read as client errors.
  MISCONFIGURED: 500,
  UPSTREAM_FAILED: 502,
  INTERNAL: 500,
};

export type ErrorDetails = Record<string, string | string[] | number | boolean | null>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetails;
  /** Seconds the caller should wait before retrying. Only meaningful for RATE_LIMITED. */
  readonly retryAfterSeconds?: number;
  /** Set when the underlying message is unsafe to show a caller (leaks internals). */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: ErrorDetails; retryAfterSeconds?: number; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
    this.retryAfterSeconds = options.retryAfterSeconds;
    // 5xx messages describe our internals, so they are replaced with a generic string
    // at the boundary. 4xx messages are written for the caller and pass through.
    this.expose = STATUS[code] < 500;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function httpStatusFor(code: ErrorCode): number {
  return STATUS[code];
}

/* Constructors — shorter at call sites than `new AppError(...)`, and they keep the
   code/message pairing consistent across modules. */

export const notFound = (what: string, details?: ErrorDetails) =>
  new AppError(ERROR_CODES.NOT_FOUND, `${what} not found`, { details });

export const forbidden = (message = "You don't have access to this.", details?: ErrorDetails) =>
  new AppError(ERROR_CODES.FORBIDDEN, message, { details });

export const unauthenticated = (message = "Sign in to continue.") =>
  new AppError(ERROR_CODES.UNAUTHENTICATED, message);

export const conflict = (message: string, details?: ErrorDetails) =>
  new AppError(ERROR_CODES.CONFLICT, message, { details });

export const unprocessable = (message: string, details?: ErrorDetails) =>
  new AppError(ERROR_CODES.UNPROCESSABLE, message, { details });

export const validationFailed = (details: ErrorDetails, message = "Please check the highlighted fields.") =>
  new AppError(ERROR_CODES.VALIDATION_FAILED, message, { details });

export const rateLimited = (retryAfterSeconds: number) =>
  new AppError(ERROR_CODES.RATE_LIMITED, "Too many attempts. Please try again shortly.", {
    retryAfterSeconds,
  });

export const misconfigured = (message: string, cause?: unknown) =>
  new AppError(ERROR_CODES.MISCONFIGURED, message, { cause });

export const upstreamFailed = (service: string, cause?: unknown) =>
  new AppError(ERROR_CODES.UPSTREAM_FAILED, `${service} did not respond as expected.`, { cause });
