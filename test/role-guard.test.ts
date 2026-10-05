import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import { IS_PUBLIC, REQUIRED_PERMISSION, ROLES_REQUIRED } from "../src/common/decorators/actor.decorator";
import { ADMIN_ROLES, type Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";
import { OfficeController } from "../src/modules/office/office.controller";
import { AdminController } from "../src/modules/admin/admin.controller";
import { LeadsController } from "../src/modules/leads/leads.controller";
import { CouponController } from "../src/modules/coupon/coupon.controller";
import { UserPermissionController } from "../src/modules/user-permission/user-permission.controller";

const actorOf = (role: Role, permissions?: Actor["permissions"]): Actor => ({
  userId: 1, loginId: "x", role, name: "X", mustChangePassword: false, transport: "cookie", permissions,
});

/** Run the real guard against a handler on `target`, as `actor`. Resolves true or throws the AppError. */
async function run(target: object, handlerName: string, actor: Actor | null) {
  const guard = new AuthGuard(new Reflector(), { resolveActor: async () => actor } as never);
  const proto = (target as { prototype: Record<string, () => void> }).prototype;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: "/x", headers: {}, cookies: {} }) }),
    getHandler: () => proto[handlerName],
    getClass: () => target,
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

/** A stand-in controller. Metadata is attached by hand: the decorators only call SetMetadata. */
class StudentOnly {
  own() {}
  open() {}
  money() {}
}
Reflect.defineMetadata(ROLES_REQUIRED, ["STUDENT"], StudentOnly.prototype.own);
Reflect.defineMetadata(ROLES_REQUIRED, ["STUDENT"], StudentOnly.prototype.open);
Reflect.defineMetadata(IS_PUBLIC, true, StudentOnly.prototype.open);
Reflect.defineMetadata(ROLES_REQUIRED, ADMIN_ROLES, StudentOnly.prototype.money);
Reflect.defineMetadata(REQUIRED_PERMISSION, "payments:read", StudentOnly.prototype.money);

describe("role guard", () => {
  it("lets the right role in and turns every other role away", async () => {
    await expect(run(StudentOnly, "own", actorOf("STUDENT"))).resolves.toBe(true);
    for (const role of ["TEACHER", ...ADMIN_ROLES] as Role[]) {
      await expect(run(StudentOnly, "own", actorOf(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("still asks anonymous callers to sign in first", async () => {
    await expect(run(StudentOnly, "own", null)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("leaves @Public routes open to everyone, signed in or not", async () => {
    await expect(run(StudentOnly, "open", null)).resolves.toBe(true);
    await expect(run(StudentOnly, "open", actorOf("TEACHER"))).resolves.toBe(true);
  });
  it("is checked before permissions, so a granted capability cannot cross panels", async () => {
    // A teacher record that somehow carries an admin permission is still not an admin.
    await expect(run(StudentOnly, "money", actorOf("TEACHER", ["payments:read"]))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(StudentOnly, "money", actorOf("ADMIN_SUPPORT"))).resolves.toBe(true);
    await expect(run(StudentOnly, "money", actorOf("IT_SUPPORT", []))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("every panel controller is closed to the other panels", () => {
  const rolesOf = (c: object) => Reflect.getMetadata(ROLES_REQUIRED, c) as Role[] | undefined;
  it("restricts the student, teacher and admin controllers at class level", () => {
    expect(rolesOf(ClassroomController)).toEqual(["STUDENT"]);
    expect(rolesOf(OfficeController)).toEqual(["TEACHER"]);
    for (const c of [AdminController, LeadsController, CouponController, UserPermissionController]) {
      expect(rolesOf(c)).toEqual(ADMIN_ROLES);
    }
  });
  it("never lets the student, teacher and admin panels overlap", () => {
    const student = rolesOf(ClassroomController)!;
    const teacher = rolesOf(OfficeController)!;
    const admin = rolesOf(AdminController)!;
    for (const r of student) expect([...teacher, ...admin]).not.toContain(r);
    for (const r of teacher) expect(admin).not.toContain(r);
  });
  it("blocks a student and a teacher from the admin dashboard route", async () => {
    for (const role of ["STUDENT", "TEACHER"] as Role[]) {
      await expect(run(AdminController, "dashboard", actorOf(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(run(AdminController, "dashboard", actorOf("IT_SUPPORT"))).resolves.toBe(true);
  });
  it("blocks cross-panel access to the student and teacher areas", async () => {
    await expect(run(ClassroomController, "dashboard", actorOf("TEACHER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(ClassroomController, "dashboard", actorOf("SUPER_ADMIN"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "dashboard", actorOf("STUDENT"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "dashboard", actorOf("ADMIN_SUPPORT"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps the metadata keys in one place", () => {
    expect([IS_PUBLIC, REQUIRED_PERMISSION, ROLES_REQUIRED]).toEqual(["isPublic", "requiredPermission", "rolesRequired"]);
  });
});
