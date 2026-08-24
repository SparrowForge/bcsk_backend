import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { Actor } from "@/common/actor";
import type { Permission } from "@/common/permissions";

/** Marks a route as reachable without a credential. Auth is required by default (risk R10). */
export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Requires a specific capability from the permission map. */
export const REQUIRED_PERMISSION = "requiredPermission";
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/** Injects the resolved actor into a controller method. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
  // The guard runs first and rejects anonymous callers, so a non-public route always has one.
  return req.actor as Actor;
});
