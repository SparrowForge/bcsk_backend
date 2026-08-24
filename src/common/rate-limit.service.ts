import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { log } from "@/common/logger";
import { rateLimited } from "@/common/errors/app-error";

/**
 * SEC-8: fixed-window rate limiting, stored in the database.
 *
 * Kept in Postgres rather than memory because the API is destined for more than one
 * instance: a per-process counter resets constantly and an attacker spreading requests
 * across instances never hits it. One upsert is negligible beside a bcrypt compare.
 *
 * Fails **open** on a database error — a limiter outage must not lock every family out of
 * the admission form. The controls that must fail closed (auth, permissions, captcha) are
 * enforced separately and do not depend on this.
 */
export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  passwordReset: { limit: 5, windowSeconds: 900 },
  apply: { limit: 5, windowSeconds: 3600 },
  contact: { limit: 5, windowSeconds: 3600 },
  payment: { limit: 20, windowSeconds: 3600 },
} as const;

export type RateLimitKind = keyof typeof RATE_LIMITS;

@Injectable()
export class RateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  /** Counts one attempt. Throws AppError(RATE_LIMITED) when the window is exhausted. */
  async consume(kind: RateLimitKind, identifier: string): Promise<void> {
    const rule = RATE_LIMITS[kind];
    const ms = rule.windowSeconds * 1000;
    const windowAt = new Date(Math.floor(Date.now() / ms) * ms);
    const bucket = `${kind}:${identifier}`;

    try {
      const row = await this.prisma.rateLimit.upsert({
        where: { bucket_windowAt: { bucket, windowAt } },
        update: { count: { increment: 1 } },
        create: { bucket, windowAt, count: 1 },
      });
      if (row.count > rule.limit) {
        const retryAfter = Math.max(1, Math.ceil((windowAt.getTime() + ms - Date.now()) / 1000));
        log.warn("auth", "rate_limited", { kind, identifier, count: row.count, limit: rule.limit });
        throw rateLimited(retryAfter);
      }
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code === "RATE_LIMITED") throw e;
      log.error("config", "rate_limit_unavailable", { kind, error: String(e) });
      // fail open
    }
  }

  /** Housekeeping — drop windows that can no longer be current. */
  async prune(olderThanHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
    const { count } = await this.prisma.rateLimit.deleteMany({ where: { windowAt: { lt: cutoff } } });
    return count;
  }
}
