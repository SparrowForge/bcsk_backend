import { SignJWT, jwtVerify } from "jose";
import { requiredSecret } from "@/config/env";
import { unauthenticated } from "@/common/errors/app-error";
import { log, errMessage } from "@/common/logger";

/**
 * SEC-7: a capability token binding a visitor to one application's payment step.
 *
 * The payment actions are public endpoints — `createCardOrder(applicationId, …)` is an
 * HTTP POST anyone can craft. Without a capability, an application ID is a guessable
 * integer, so any visitor could create payment rows against other people's applications
 * or spam duplicates onto one.
 *
 * The token is signed, carries the application ID as its subject, and expires. It proves
 * "the bearer submitted this application" and nothing else — it is not a login, grants no
 * access to application data, and is useless once the application is paid.
 */

const SECRET = new TextEncoder().encode(requiredSecret("JWT_SECRET"));
const AUDIENCE = "bcsk:application-payment";

/** Applicants may take days to arrange a bank transfer, so the window is generous. */
const TTL = "14d";

export async function issuePaymentToken(applicationId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(applicationId))
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(SECRET);
}

/**
 * Verify a token against the application it claims to authorise.
 * Returns false for a missing, malformed, expired, wrong-audience, or mismatched token.
 */
export async function verifyPaymentToken(
  token: string | undefined | null,
  applicationId: number
): Promise<boolean> {
  if (!token) {
    log.warn("payment", "payment_token_missing", { applicationId });
    return false;
  }
  try {
    const { payload } = await jwtVerify(token, SECRET, { audience: AUDIENCE });
    if (payload.sub !== String(applicationId)) {
      // A valid token for a *different* application — the signature is fine, so this is
      // someone replaying their own token against another applicant's record.
      log.warn("payment", "payment_token_mismatch", {
        applicationId,
        tokenSubject: String(payload.sub),
      });
      return false;
    }
    return true;
  } catch (e) {
    log.warn("payment", "payment_token_invalid", { applicationId, error: errMessage(e) });
    return false;
  }
}

/** Guard for server actions: throws unless the token authorises this application. */
export async function assertPaymentToken(token: string | undefined | null, applicationId: number) {
  if (!(await verifyPaymentToken(token, applicationId))) {
    // AppError, not a plain Error: the filter must classify this as a refused credential
    // (401), not an unhandled crash (500). A bare throw here leaked a 500 to callers.
    throw unauthenticated("This payment link is invalid or has expired. Start a new application.");
  }
}
