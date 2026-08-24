import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { PrismaService } from "@/database/prisma.service";
import { requiredSecret, intFromEnv } from "@/config/env";
import { log } from "@/common/logger";
import type { Role } from "@/common/constants";
import type { Actor, ActorTransport } from "@/common/actor";

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

@Injectable()
export class AuthService {
  private readonly secret = new TextEncoder().encode(requiredSecret("JWT_SECRET"));
  private readonly sessionHours = intFromEnv("SESSION_HOURS", 8);

  constructor(private readonly prisma: PrismaService) {}

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
