import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC, REQUIRED_MENU, REQUIRED_PERMISSION, ROLES_REQUIRED } from "../decorators/actor.decorator";
import { flagForMethod } from "../menu-permissions";
import type { Role } from "../constants";
import { AuthService } from "../../modules/auth/auth.service";
import type { Permission } from "../permissions";
import { forbidden, unauthenticated } from "../errors/app-error";
import { log } from "../logger";
import { actorCanOnMenu, actorHas, type Actor } from "../actor";

/**
 * Registered globally in AppModule, so **every** route is authenticated unless it is
 * explicitly marked `@Public()`.
 *
 * That default is deliberate and is risk R10 from the separation plan: a second HTTP surface
 * silently becoming an unguarded one. Forgetting to think about auth here produces a locked
 * endpoint, not an open one.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const targets = [context.getHandler(), context.getClass()];

    // Resolve the actor regardless — a public endpoint may still personalise for a signed-in
    // visitor, and audit logging wants to know who called even when anyone may.
    const actor = await this.auth.resolveActor(req);
    if (actor) req.actor = actor;

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!actor) throw unauthenticated();

    // Which panel is this? A route marked for other roles is closed to everyone else, whatever
    // permissions they hold - a student never reaches an admin route by being granted a capability.
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_REQUIRED, targets);
    if (roles && !roles.includes(actor.role)) {
      log.warn("auth", "api_role_denied", { route: req.originalUrl, userId: actor.userId, role: actor.role });
      throw forbidden("This area is not available to your account.");
    }

    // Teacher and student pages are checked per menu: the switch this HTTP method needs.
    const menuKey = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_MENU, targets);
    if (menuKey && !actorCanOnMenu(actor, menuKey, flagForMethod(req.method))) {
      log.warn("auth", "api_menu_denied", { route: req.originalUrl, userId: actor.userId, role: actor.role, menu: menuKey });
      throw forbidden("You don't have access to this.");
    }

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (required && !actorHas(actor, required)) {
      log.warn("auth", "api_permission_denied", {
        route: req.originalUrl,
        userId: actor.userId,
        role: actor.role,
        permission: required,
      });
      throw forbidden("You don't have access to this.");
    }
    return true;
  }
}
