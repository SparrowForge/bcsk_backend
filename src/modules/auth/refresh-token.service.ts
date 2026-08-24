import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaService } from "@/database/prisma.service";
import { unauthenticated } from "@/common/errors/app-error";
import { log } from "@/common/logger";

/**
 * Phase F — refresh tokens for mobile clients.
 *
 * Three properties matter, and each addresses a specific way this goes wrong:
 *
 * 1. **Hashed at rest.** The plaintext is returned once and never stored, so a database
 *    leak yields nothing usable. This is the same reasoning as password hashing.
 * 2. **Rotated on every use.** A refresh consumes its token and issues a new one, so a
 *    stolen token has a short useful life.
 * 3. **Reuse revokes the family.** If an already-rotated token is presented, either the
 *    client replayed or an attacker is using a copy. We cannot tell which, so we revoke
 *    every descendant and force a fresh login. That is the standard theft response.
 */

const DAY_MS = 86_400_000;

function parseTtlDays(raw: string | undefined, fallbackDays: number): number {
  const m = /^(\d+)d$/.exec(raw?.trim() ?? "");
  return m ? Number(m[1]) : fallbackDays;
}

@Injectable()
export class RefreshTokenService {
  private readonly ttlDays = parseTtlDays(process.env.JWT_REFRESH_TTL, 30);

  constructor(private readonly prisma: PrismaService) {}

  /** Opaque, high-entropy, and never a JWT — there is nothing here worth self-describing. */
  private mint(): { plaintext: string; hash: string } {
    const plaintext = randomBytes(48).toString("base64url");
    return { plaintext, hash: createHash("sha256").update(plaintext).digest("hex") };
  }

  async issue(userId: number, deviceName?: string, familyId: string = randomUUID()) {
    const { plaintext, hash } = this.mint();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hash,
        familyId,
        deviceName: deviceName ?? null,
        expiresAt: new Date(Date.now() + this.ttlDays * DAY_MS),
      },
    });
    return { refreshToken: plaintext, familyId, expiresInDays: this.ttlDays };
  }

  /**
   * Consume a refresh token and issue its successor.
   * Throws `UNAUTHENTICATED` for anything that is not a live, unexpired, unrevoked token.
   */
  async rotate(presented: string) {
    const hash = createHash("sha256").update(presented).digest("hex");
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: { select: { id: true, active: true, loginId: true } } },
    });

    if (!row) throw unauthenticated("Your session has expired. Please sign in again.");

    if (row.revokedAt) {
      // Theft signal: this token was already rotated away, so someone is holding a copy.
      await this.revokeFamily(row.familyId);
      log.error("auth", "refresh_reuse_detected", {
        userId: row.userId,
        familyId: row.familyId,
        loginId: row.user.loginId,
      });
      throw unauthenticated("Your session has expired. Please sign in again.");
    }

    if (row.expiresAt < new Date() || !row.user.active) {
      await this.prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      throw unauthenticated("Your session has expired. Please sign in again.");
    }

    // Consume, then issue the successor into the same family.
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    const next = await this.issue(row.userId, row.deviceName ?? undefined, row.familyId);
    log.info("auth", "refresh_rotated", { userId: row.userId, familyId: row.familyId });
    return { userId: row.userId, ...next };
  }

  async revoke(presented: string): Promise<void> {
    const hash = createHash("sha256").update(presented).digest("hex");
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Sign the holder out of every device — used after a password change. */
  async revokeAllForUser(userId: number): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Housekeeping: expired and long-revoked rows serve no purpose. */
  async prune(): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: new Date(Date.now() - 30 * DAY_MS) } },
        ],
      },
    });
    return count;
  }
}
