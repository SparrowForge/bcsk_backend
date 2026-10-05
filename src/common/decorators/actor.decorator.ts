import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { Actor } from "../actor";
import type { Permission } from "../permissions";
import type { Role } from "../constants";

/** Marks a route as reachable without a credential. Auth is required by default (risk R10). */
export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires a specific capability from the permission map. */
export const REQUIRED_PERMISSION = "requiredPermission";
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/**
 * Restricts a route - or a whole controller - to the listed roles: the panel it belongs to.
 * Checked by the global AuthGuard before any permission, so a new route added to the student,
 * teacher or admin controller is closed to the other panels by default instead of open to every
 * signed-in user. `@Public()` routes are exempt, as always. Combine with `@RequirePermission`
 * for admin capabilities; the role says *which panel*, the permission says *what in it*.
 */
export const ROLES_REQUIRED = "rolesRequired";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_REQUIRED, roles);

/** Injects the resolved actor into a controller method. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
  // The guard runs first and rejects anonymous callers, so a non-public route always has one.
  return req.actor as Actor;
});
