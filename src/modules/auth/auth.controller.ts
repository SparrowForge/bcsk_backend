import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { clientIp } from "../../common/client-ip";
import { z } from "zod";
import { AuthService, SESSION_COOKIE } from "./auth.service";
import { RefreshTokenService } from "./refresh-token.service";
import { CurrentActor, Public } from "../../common/decorators/actor.decorator";
import { actorHas } from "../../common/actor";
import { MenuCatalogService } from "../../common/menu-catalog.service";
import { PERMISSIONS } from "../../common/permissions";
import { unauthenticated } from "../../common/errors/app-error";
import { ADMIN_ROLES, type Role } from "../../common/constants";
import type { Actor } from "../../common/actor";

const loginSchema = z.object({
  loginId: z.string().trim().min(1, "Enter your ID."),
  password: z.string().min(1, "Enter your password."),
  surface: z.enum(["classroom", "office", "admin"]),
  /** Mobile only, for the "signed-in devices" list. */
  deviceName: z.string().max(80).optional(),
});

/** Which roles may sign in on which surface — unchanged from the monolith. */
const ROLES_FOR: Record<z.infer<typeof loginSchema>["surface"], Role[]> = {
  classroom: ["STUDENT"],
  office: ["TEACHER"],
  admin: ADMIN_ROLES,
};

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly refresh: RefreshTokenService,
    private readonly menuCatalog: MenuCatalogService,
  ) {}

  /**
   * Web sends `mode: "cookie"` and receives an httpOnly cookie — the stronger option against
   * XSS, and it preserves the existing session model. Mobile omits it and receives the token
   * in the body for its keychain. One credential, two transports.
   */
  @Public()
  @Post("login")
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { loginId, password, surface, deviceName } = loginSchema.parse(body);
    const user = await this.auth.verifyCredentials(loginId, password, ROLES_FOR[surface]);
    if (!user) {
      // One message for every failure — never reveal which half was wrong.
      throw unauthenticated("That ID and password combination doesn't match our records.");
    }

    const token = await this.auth.signSession(user);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: this.auth.sessionMaxAgeSeconds * 1000,
      path: "/",
    });

    // Phase F: mobile also receives a refresh token. Web ignores it and relies on the
    // cookie, which is why the cookie is set regardless of client.
    const { refreshToken } = await this.refresh.issue(user.id, deviceName);

    return {
      token,
      refreshToken,
      user: {
        userId: user.id,
        loginId: user.loginId,
        role: user.role,
        name: user.name,
        // SEC-2: the client must route to the change-password screen before anything else.
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /**
   * Exchange a refresh token for a new access token. The presented token is consumed;
   * presenting it twice revokes the whole family (see RefreshTokenService).
   */
  @Public()
  @Post("refresh")
  async refreshTokens(@Body() body: unknown) {
    const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(body);
    const rotated = await this.refresh.rotate(refreshToken);
    const user = await this.auth.userById(rotated.userId);
    if (!user) throw unauthenticated("Your session has expired. Please sign in again.");
    return {
      token: await this.auth.signSession(user),
      refreshToken: rotated.refreshToken,
      user: {
        userId: user.id, loginId: user.loginId, role: user.role,
        name: user.name, mustChangePassword: user.mustChangePassword,
      },
    };
  }

  /** Always `{ ok: true }` — never reveals whether the ID or email exists. */
  @Public()
  @Post("forgot-password")
  async forgotPassword(@Body() body: unknown, @Req() req: Request) {
    const { identifier } = z.object({ identifier: z.string().trim().min(1).max(254) }).parse(body);
    await this.auth.requestPasswordReset(identifier, clientIp(req));
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  async resetPassword(@Body() body: unknown) {
    const { token, password } = z
      .object({ token: z.string().min(1).max(200), password: z.string().min(10, "Use at least 10 characters.").max(200) })
      .parse(body);
    await this.auth.completePasswordReset(token, password);
    return { ok: true };
  }

  @Post("logout")
  @Public()
  async logout(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    // A mobile client sends its refresh token so the server-side record is revoked too;
    // clearing a cookie the client never had would otherwise be a no-op for them.
    const parsed = z.object({ refreshToken: z.string().optional() }).safeParse(body ?? {});
    if (parsed.success && parsed.data.refreshToken) await this.refresh.revoke(parsed.data.refreshToken);
    return { ok: true };
  }

  /**
   * The current actor plus their capabilities.
   *
   * Permissions are served from here rather than duplicated in the frontend: the map lives in
   * one place, and a UI that hides a button and an API that refuses the call can never
   * disagree (SEC-4 / SEC-5).
   */
  @Get("me")
  async me(@CurrentActor() actor: Actor) {
    return {
      userId: actor.userId,
      loginId: actor.loginId,
      role: actor.role,
      name: actor.name,
      mustChangePassword: actor.mustChangePassword,
      permissions: PERMISSIONS.filter((p) => actorHas(actor, p)),
      // The menus this person's sidebar is built from: active, in their own panel, Access held.
      menus: (await this.menuCatalog.all())
        .filter((m) => m.active && actor.menus?.[m.key]?.access)
        .map((m) => ({ key: m.key, module: m.module, label: m.label, href: m.href, flags: actor.menus![m.key] })),
    };
  }
}
