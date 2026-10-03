import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import bcrypt from "bcryptjs";
import { PrismaService } from "../../database/prisma.service";
import { createHash, randomBytes } from "node:crypto";
import { requiredSecret, intFromEnv, strFromEnv } from "../../config/env";
import { log } from "../../common/logger";
import { MailService } from "../../common/mail.service";
import { RateLimitService } from "../../common/rate-limit.service";
import { unprocessable } from "../../common/errors/app-error";
import { SignJWT, jwtVerify } from "../../common/jose";
import type { Role } from "../../common/constants";
import type { Actor, ActorTransport } from "../../common/actor";

/**
 * Authentication for both transports.
 *
 * SEC-1 carries over: there is no fallback secret. A missing or blank `JWT_SECRET` fails the
 * boot rather than quietly signing tokens with a value that is public in the repository.
 *
 * Cookie and bearer credentials converge on `sessionFromToken`, so they are verified by
 * exactly one implementation and subject to the same live `active` / `mustChangePassword`
 * checks. Two copies is how a web surface and a mobile surface drift apart.
 */
export const SESSION_COOKIE = "bcsk_session";

const RESET_TTL_MS = 60 * 60 * 1000;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

@Injectable()
export class AuthService {
  private readonly secret = new TextEncoder().encode(requiredSecret("JWT_SECRET"));
  private readonly sessionHours = intFromEnv("SESSION_HOURS", 8);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Where the emailed link points: `APP_BASE_URL`, else the first non-localhost CORS origin
   * (so a deploy missing the variable never emails a localhost link), else localhost for dev.
   */
  private appBaseUrl(): string {
    const origins = (process.env.APP_BASE_URL ?? "").split(",").map((o) => o.trim()).filter(Boolean);
    const real = origins.find((o) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(o));
    return strFromEnv("APP_BASE_URL", real ?? origins[0] ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  /**
   * Email a one-hour reset link. `identifier` is a login ID or an email address; the same
   * email can belong to several children, so each matching account gets its own link.
   *
   * Always resolves the same way whether or not anything matched, so the endpoint cannot be
   * used to discover which IDs or addresses are registered. Only the SHA-256 of the token is
   * stored — a database leak must not yield usable links.
   */
  async requestPasswordReset(identifier: string, ip: string): Promise<void> {
    await this.rateLimit.consume("passwordReset", ip);
    await this.rateLimit.consume("passwordReset", `id:${identifier.toLowerCase()}`);

    const users = await this.prisma.user.findMany({
      where: {
        active: true,
        email: { not: null },
        OR: [{ loginId: identifier }, { email: { equals: identifier, mode: "insensitive" } }],
      },
      take: 5,
    });
    if (users.length === 0) {
      log.info("auth", "password_reset_no_match", { identifier });
      return;
    }

    const links: { loginId: string; url: string }[] = [];
    for (const u of users) {
      const token = randomBytes(32).toString("base64url");
      await this.prisma.passwordReset.create({
        data: { userId: u.id, token: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      links.push({ loginId: u.loginId, url: `${this.appBaseUrl()}/reset-password?token=${token}` });
    }

    const body = links
      .map(
        (l) =>
          `<p style="font-size:14px;color:#232323">Account <b>${l.loginId}</b>:<br><a href="${l.url}" style="color:#1d2b64">Set a new password</a><br><span style="font-size:12px;color:#5b5b6b;word-break:break-all">${l.url}</span></p>`,
      )
      .join("");
    const { simulated } = await this.mail.send(
      users[0]!.email!,
      "Reset your BCSK password",
      this.mail.layout(
        "Reset your password",
        `${body}<p style="font-size:12px;color:#5b5b6b">These links work once and expire in one hour. If you did not ask for this, ignore this email — your password has not changed.</p>`,
      ),
    );
    log.info("auth", "password_reset_requested", { accounts: users.map((u) => u.loginId).join(","), emailSimulated: simulated });
  }

  /** Consume a reset token and set the new password. */
  async completePasswordReset(token: string, newPassword: string): Promise<void> {
    const row = await this.prisma.passwordReset.findUnique({ where: { token: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw unprocessable("This reset link is invalid or has expired. Request a new one.");
    }
    const hash = await bcrypt.hash(newPassword, 12);
    const now = new Date();
    // The conditional updateMany makes the token single-use even under concurrent requests.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordReset.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) return false;
      await tx.user.update({
        where: { id: row.userId },
        data: { passwordHash: hash, mustChangePassword: false, passwordChangedAt: now },
      });
      await tx.passwordReset.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } });
      return true;
    });
    if (!claimed) throw unprocessable("This reset link is invalid or has expired. Request a new one.");
    log.info("auth", "password_reset_completed", { userId: row.userId });
  }

  /** Look up a user for token refresh. */
  async userById(id: number) {
    return this.prisma.user.findFirst({ where: { id, active: true } });
  }

  /** Issue a session JWT. Used for the web cookie today; Phase F adds access/refresh pairs. */
  async signSession(user: { id: number; loginId: string; role: string; name: string }): Promise<string> {
    return new SignJWT({ loginId: user.loginId, role: user.role, name: user.name })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime(`${this.sessionHours}h`)
      .sign(this.secret);
  }

  get sessionMaxAgeSeconds(): number {
    return this.sessionHours * 3600;
  }

  /**
   * Verify a token and load the live user state behind it.
   *
   * `mustChangePassword` and `active` are read from the database rather than carried in the
   * token, so a credential rotation or a deactivation takes effect on the very next request
   * without having to reissue anyone's session (NFR-SEC-05, SEC-2).
   */
  async sessionFromToken(token: string | undefined, transport: ActorTransport): Promise<Actor | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret);
      const userId = Number(payload.sub);
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { active: true, mustChangePassword: true },
      });
      if (!user?.active) return null;
      return {
        userId,
        loginId: payload.loginId as string,
        role: payload.role as Role,
        name: payload.name as string,
        mustChangePassword: user.mustChangePassword,
        transport,
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolve whoever is calling, from either transport.
   *
   * Bearer wins when both are present: a mobile client may carry a stale cookie from an
   * in-app browser, and the credential it explicitly presented is the one it means to use.
   */
  async resolveActor(req: Request): Promise<Actor | null> {
    const header = req.headers.authorization;
    if (header) {
      const [scheme, token] = header.split(" ");
      if (scheme?.toLowerCase() === "bearer" && token) {
        return this.sessionFromToken(token.trim(), "bearer");
      }
    }
    const cookie = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    return cookie ? this.sessionFromToken(cookie, "cookie") : null;
  }

  /**
   * Verify credentials for a surface. Returns the user or null.
   *
   * The caller shows one generic message for every failure; the specific reason is logged for
   * operators only, so failures stay diagnosable without the endpoint becoming an oracle for
   * which account names exist.
   */
  async verifyCredentials(loginId: string, password: string, allowedRoles: Role[]) {
    const user = await this.prisma.user.findUnique({ where: { loginId } });
    if (!user) {
      log.warn("auth", "login_failed", { loginId, reason: "unknown_login_id" });
      return null;
    }
    if (!user.active) {
      log.warn("auth", "login_failed", { loginId, userId: user.id, reason: "account_inactive" });
      return null;
    }
    if (!allowedRoles.includes(user.role as Role)) {
      log.warn("auth", "login_failed", { loginId, userId: user.id, role: user.role, reason: "wrong_surface" });
      return null;
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      log.warn("auth", "login_failed", { loginId, userId: user.id, reason: "bad_password" });
      return null;
    }
    log.info("auth", "login_succeeded", {
      loginId,
      userId: user.id,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });
    return user;
  }
}
