import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import { ADMIN_ROLES, PRIVILEGED_ROLES, type Role } from "../src/common/constants";
import { PERMISSIONS, permissionsFor, type Permission } from "../src/common/permissions";
import { DEFAULT_MENUS, effectiveAccess, panelOfRole, CUSTOMISABLE_ROLES } from "../src/common/menu-permissions";
import { assertSameInstitute, inInstitute } from "../src/common/institute-scope";
import { auditDiff } from "../src/common/audit.service";
import { issuedBeforePasswordChange } from "../src/modules/auth/auth.service";
import { RefreshTokenService } from "../src/modules/auth/refresh-token.service";
import { UserService } from "../src/modules/user/user.service";
import { AdminController } from "../src/modules/admin/admin.controller";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";
import { OfficeController } from "../src/modules/office/office.controller";
import { UserController } from "../src/modules/user/user.controller";
import { UserPermissionController } from "../src/modules/user-permission/user-permission.controller";
import type { Actor } from "../src/common/actor";

const actorOf = (role: Role, instituteId = 1, permissions?: Actor["permissions"]): Actor => ({
  userId: 7, loginId: "x", role, name: "X", instituteId, mustChangePassword: false, transport: "cookie", permissions,
});

async function run(target: object, handlerName: string, actor: Actor | null) {
  const guard = new AuthGuard(new Reflector(), { resolveActor: async () => actor } as never);
  const proto = (target as { prototype: Record<string, () => void> }).prototype;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: "/x", method: "GET", headers: {}, cookies: {} }) }),
    getHandler: () => proto[handlerName],
    getClass: () => target,
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

/* ------------------------------------------------------------------ permission matrix */

const HEAD_MASTER_ALLOWED: Permission[] = [
  "admissions:read", "payments:read", "payments:export",
  "institute:manage", "departments:manage", "subjects:manage", "sections:manage",
  "courses:manage", "scheduling:manage", "staff:read", "students:read", "calendar:manage",
  "attendance:record", "materials:manage", "assignments:manage", "exams:manage",
  "results:approve", "results:publish", "reports:manage", "certificates:issue", "leave:review", "leave:decide",
  "transfer:verify", "transfer:decide", "analytics:read", "audit:read",
];

describe("Head Master permission matrix", () => {
  it("holds exactly the academic and approval capabilities", () => {
    expect([...permissionsFor("HEAD_MASTER")].sort()).toEqual([...HEAD_MASTER_ALLOWED].sort());
  });
  it("sees admissions and money but cannot decide, verify or refund; no CRM, content or accounts", () => {
    const denied = PERMISSIONS.filter((p) => !HEAD_MASTER_ALLOWED.includes(p));
    expect(denied).toEqual(expect.arrayContaining([
      "admissions:decide", "payments:verify", "payments:refund",
      "fees:manage", "leads:manage", "cms:manage", "users:manage", "permissions:manage", "settings:manage",
    ]));
    for (const p of denied) expect(permissionsFor("HEAD_MASTER")).not.toContain(p);
  });
  it("leaves the existing roles as they were, apart from the office's transfer clearance and certificates", () => {
    const lms = PERMISSIONS.slice(PERMISSIONS.indexOf("institute:manage"));
    for (const p of lms) expect(permissionsFor("IT_SUPPORT")).not.toContain(p);
    // B6: the office clears dues and library on a transfer, and prints certificates as it printed
    // student documents before; nothing else of the LMS is theirs.
    expect(lms.filter((p) => permissionsFor("ADMIN_SUPPORT").includes(p))).toEqual(["certificates:issue", "transfer:verify"]);
    expect(permissionsFor("IT_SUPPORT")).toEqual(["users:manage", "tickets:manage"]);
    expect(permissionsFor("TEACHER")).toEqual([]);
    expect(permissionsFor("STUDENT")).toEqual([]);
    expect(permissionsFor("SUPER_ADMIN")).toEqual(PERMISSIONS);
  });
  it("signs in on the admin panel and can have a custom menu grid", () => {
    expect(ADMIN_ROLES).toContain("HEAD_MASTER");
    expect(panelOfRole("HEAD_MASTER")).toBe("ADMIN");
    expect(CUSTOMISABLE_ROLES).toContain("HEAD_MASTER");
    expect(PRIVILEGED_ROLES).toEqual(["SUPER_ADMIN", "HEAD_MASTER"]);
  });
  it("gets the academic menus and read-only admissions and payments by default", () => {
    const { menus } = effectiveAccess("HEAD_MASTER", null, DEFAULT_MENUS);
    for (const key of ["courses", "curriculum", "scheduling", "reports", "audit", "admissions", "payments"]) expect(menus[key]?.access).toBe(true);
    expect(menus.admissions?.update).toBe(false);
    expect(menus.payments?.update).toBe(false);
    expect(menus.payments?.delete).toBe(false);
    for (const key of ["fees", "leads", "cms", "users", "settings"]) expect(menus[key]?.access).toBe(false);
  });
});

describe("Head Master at the API guard", () => {
  it("reaches academic admin routes", async () => {
    await expect(run(AdminController, "dashboard", actorOf("HEAD_MASTER"))).resolves.toBe(true);
    await expect(run(AdminController, "listCourses", actorOf("HEAD_MASTER"))).resolves.toBe(true);
    await expect(run(AdminController, "audit", actorOf("HEAD_MASTER"))).resolves.toBe(true);
  });
  it("is refused money, content, accounts and permissions", async () => {
    for (const [c, h] of [
      [AdminController, "verifyPayment"], [AdminController, "listPages"],
      [UserController, "list"], [UserController, "create"],
    ] as const) {
      await expect(run(c, h, actorOf("HEAD_MASTER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const proto = UserPermissionController.prototype as unknown as Record<string, unknown>;
    const handler = Object.getOwnPropertyNames(proto).find((n) => n !== "constructor")!;
    await expect(run(UserPermissionController, handler, actorOf("HEAD_MASTER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("cannot enter the student or teacher panels", async () => {
    await expect(run(ClassroomController, "dashboard", actorOf("HEAD_MASTER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "dashboard", actorOf("HEAD_MASTER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/* ------------------------------------------------------------------ institute isolation */

describe("institute scope", () => {
  it("bounds a query and a create to the actor's institute", () => {
    expect(inInstitute(actorOf("HEAD_MASTER", 3))).toEqual({ instituteId: 3 });
  });
  it("answers not-found for another institute's row, never forbidden", () => {
    const a = actorOf("SUPER_ADMIN", 1);
    expect(assertSameInstitute(a, { id: 5, instituteId: 1 }, "User")).toEqual({ id: 5, instituteId: 1 });
    expect(() => assertSameInstitute(a, { id: 5, instituteId: 2 }, "User")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
    expect(() => assertSameInstitute(a, null, "User")).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  });
});

/* ------------------------------------------------------------------ user service */

function userService(rows: { id: number; loginId: string; role: string; instituteId: number; email: string | null }[]) {
  const created: unknown[] = [];
  const prisma = {
    user: {
      findMany: vi.fn(async (args: unknown) => args),
      findUnique: vi.fn(async ({ where }: { where: { id?: number; loginId?: string } }) =>
        rows.find((r) => r.id === where.id || r.loginId === where.loginId) ?? null),
      create: vi.fn(async ({ data }: { data: unknown }) => { created.push(data); return data; }),
      update: vi.fn(async ({ where }: { where: { id: number } }) => rows.find((r) => r.id === where.id)),
    },
    refreshToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const mail = { send: vi.fn(async () => ({ simulated: true })), layout: (t: string, b: string) => t + b };
  const refresh = { revokeAllForUser: vi.fn(async () => undefined), issue: vi.fn(async () => ({ refreshToken: "r" })) };
  const svc = new UserService(prisma as never, audit as never, mail as never, {} as never, refresh as never);
  return { svc, prisma, audit, created, refresh };
}

describe("user management", () => {
  const rows = [
    { id: 10, loginId: "t1", role: "TEACHER", instituteId: 1, email: null },
    { id: 20, loginId: "other", role: "TEACHER", instituteId: 2, email: null },
    { id: 30, loginId: "admin", role: "SUPER_ADMIN", instituteId: 1, email: null },
  ];
  it("lists only the actor's institute", async () => {
    const { svc } = userService(rows);
    const args = (await svc.list(actorOf("IT_SUPPORT", 1))) as unknown as { where: unknown };
    expect(args.where).toEqual({ instituteId: 1 });
  });
  it("files a new account under the creator's institute", async () => {
    const { svc, created } = userService(rows);
    await svc.create({ loginId: "new1", name: "New", role: "TEACHER" }, actorOf("IT_SUPPORT", 1), "203.0.113.9");
    expect(created[0]).toMatchObject({ instituteId: 1, role: "TEACHER", mustChangePassword: true });
  });
  it("lets only a super admin create a Head Master or super admin", async () => {
    for (const role of ["HEAD_MASTER", "SUPER_ADMIN"]) {
      const { svc, created } = userService(rows);
      await expect(svc.create({ loginId: `x-${role}`, name: "X", role }, actorOf("IT_SUPPORT"))).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(created).toHaveLength(0);
    }
    const { svc, created } = userService(rows);
    await svc.create({ loginId: "hm1", name: "Head", role: "HEAD_MASTER" }, actorOf("SUPER_ADMIN"));
    expect(created[0]).toMatchObject({ role: "HEAD_MASTER", mustChangePassword: true });
  });
  it("cannot reset or deactivate another institute's account", async () => {
    const { svc, prisma } = userService(rows);
    await expect(svc.resetPassword(20, actorOf("IT_SUPPORT", 1))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.setActive(20, false, actorOf("IT_SUPPORT", 1))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
  it("keeps IT support off the super admin account", async () => {
    const { svc } = userService(rows);
    await expect(svc.resetPassword(30, actorOf("IT_SUPPORT", 1))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.setActive(30, false, actorOf("IT_SUPPORT", 1))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("ends the holder's sessions on an office reset and records the caller's address", async () => {
    const { svc, prisma, audit } = userService(rows);
    await svc.resetPassword(10, actorOf("IT_SUPPORT", 1), "203.0.113.9");
    const data = (prisma.user.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.passwordChangedAt).toBeInstanceOf(Date);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 10, revokedAt: null } }));
    expect(audit.record).toHaveBeenCalledWith(7, "USER_PASSWORD_RESET", "User", 10, undefined, { ip: "203.0.113.9" });
  });
  it("revokes refresh tokens when an account is switched off", async () => {
    const { svc, refresh } = userService(rows);
    await svc.setActive(10, false, actorOf("IT_SUPPORT", 1));
    expect(refresh.revokeAllForUser).toHaveBeenCalledWith(10);
  });
});

/* ------------------------------------------------------------------ token lifetime */

describe("password change retires earlier access tokens", () => {
  const changed = new Date("2026-10-22T10:00:00.500Z");
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  it("keeps tokens when the password never changed", () => {
    expect(issuedBeforePasswordChange(at("2026-01-01T00:00:00Z"), null)).toBe(false);
  });
  it("rejects a token issued before the change", () => {
    expect(issuedBeforePasswordChange(at("2026-10-22T09:59:59Z"), changed)).toBe(true);
  });
  it("keeps the token issued in the same second as the change, and later ones", () => {
    expect(issuedBeforePasswordChange(at("2026-10-22T10:00:00Z"), changed)).toBe(false);
    expect(issuedBeforePasswordChange(at("2026-10-22T10:05:00Z"), changed)).toBe(false);
  });
  it("rejects a token with no issue time once a change is on record", () => {
    expect(issuedBeforePasswordChange(undefined, changed)).toBe(true);
  });
});

/* ------------------------------------------------------------------ refresh tokens */

/** An in-memory stand-in for the refreshToken table, enough for RefreshTokenService. */
function refreshStore() {
  type Row = { id: number; userId: number; tokenHash: string; familyId: string; deviceName: string | null; expiresAt: Date; revokedAt: Date | null; lastUsedAt?: Date | null };
  const rows: Row[] = [];
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v);
  const prisma = {
    refreshToken: {
      create: async ({ data }: { data: Omit<Row, "id" | "revokedAt"> }) => { rows.push({ ...data, id: rows.length + 1, revokedAt: null }); },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const r = rows.find((x) => x.tokenHash === where.tokenHash);
        return r ? { ...r, user: { id: r.userId, active: true, loginId: "u" } } : null;
      },
      update: async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  };
  return { rows, svc: new RefreshTokenService(prisma as never) };
}

describe("refresh token rotation", () => {
  it("rotates: the old token is consumed and a successor issued in the same family", async () => {
    const { svc, rows } = refreshStore();
    const first = await svc.issue(1, "web");
    const next = await svc.rotate(first.refreshToken);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    expect(next.familyId).toBe(first.familyId);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
  });
  it("answers a second use within a minute of rotation as 'in progress', revoking nothing", async () => {
    const { svc, rows } = refreshStore();
    const first = await svc.issue(1);
    const second = await svc.rotate(first.refreshToken);
    await expect(svc.rotate(first.refreshToken)).rejects.toMatchObject({ code: "CONFLICT", details: { reason: "refresh_in_progress" } });
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
    await expect(svc.rotate(second.refreshToken)).resolves.toMatchObject({ userId: 1 });
  });
  it("treats reuse of a consumed token after that minute as theft and revokes the whole family", async () => {
    const { svc, rows } = refreshStore();
    const first = await svc.issue(1);
    const second = await svc.rotate(first.refreshToken);
    // Age the consumed token past the grace window.
    rows[0]!.lastUsedAt = new Date(Date.now() - 61_000);
    await expect(svc.rotate(first.refreshToken)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(svc.rotate(second.refreshToken)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("gives a logged-out token no grace", async () => {
    const { svc } = refreshStore();
    const t = await svc.issue(1);
    await svc.revoke(t.refreshToken); // logout stamps no lastUsedAt
    await expect(svc.rotate(t.refreshToken)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("stops working after logout", async () => {
    const { svc } = refreshStore();
    const t = await svc.issue(1);
    await svc.revoke(t.refreshToken);
    await expect(svc.rotate(t.refreshToken)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("refuses an unknown token", async () => {
    const { svc } = refreshStore();
    await expect(svc.rotate("not-a-token")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

/* ------------------------------------------------------------------ audit */

describe("audit diff", () => {
  it("keeps only the fields that changed", () => {
    expect(auditDiff({ name: "A", active: true, n: 1 }, { name: "B", active: true, n: 1 }))
      .toEqual({ before: { name: "A" }, after: { name: "B" } });
  });
  it("is null when nothing changed", () => {
    expect(auditDiff({ a: [1, 2] }, { a: [1, 2] })).toBeNull();
  });
});
