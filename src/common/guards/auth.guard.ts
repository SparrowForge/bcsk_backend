import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC, REQUIRED_PERMISSION } from "@/common/decorators/actor.decorator";
import { AuthService } from "@/modules/auth/auth.service";
import { roleHas, type Permission } from "@/common/permissions";
import { forbidden, unauthenticated } from "@/common/errors/app-error";
import { log } from "@/common/logger";
import type { Actor } from "@/common/actor";

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

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (required && !roleHas(actor.role, required)) {
      log.warn("auth", "api_permission_denied", {
        route: req.originalUrl,
        userId: actor.userId,
        role: actor.role,
        permission: required,
      });
      throw forbidden("Your role doesn't have access to this.");
    }
    return true;
  }
}
