import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import {
  DEFAULT_MENUS, MENU_GRANTS, effectiveAccess, flagForMethod, gridForRole, normaliseGrid, offeredFlags, panelOfRole,
  permissionsFromGrid, type MenuRow,
} from "../src/common/menu-permissions";
import { toMenuRow } from "../src/common/menu-catalog.service";
import { PERMISSIONS, permissionsFor } from "../src/common/permissions";
import { actorCanOnMenu, actorHas, type Actor } from "../src/common/actor";
import { AuthGuard } from "../src/common/guards/auth.guard";
import { REQUIRED_MENU, ROLES_REQUIRED } from "../src/common/decorators/actor.decorator";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";
import { OfficeController } from "../src/modules/office/office.controller";
import { menuSchema, menuUpdateSchema } from "../src/modules/user-permission/menu.service";

const row = (menuKey: string, f: Partial<{ a: boolean; i: boolean; u: boolean; d: boolean }> = {}) => ({
  menuKey, canAccess: !!f.a, canInsert: !!f.i, canUpdate: !!f.u, canDelete: !!f.d,
});
const menu = (k: string) => DEFAULT_MENUS.find((m) => m.key === k)!;
const ofPanel = (p: string) => DEFAULT_MENUS.filter((m) => m.panel === p);

describe("menu catalog", () => {
  it("covers every admin sidebar menu, and the teacher and student panels", () => {
    expect(ofPanel("ADMIN")).toHaveLength(18);
    expect(ofPanel("TEACHER").map((m) => m.label)).toEqual(["My Classes", "Questions", "Task List", "Guardians"]);
    expect(ofPanel("STUDENT").length).toBe(10);
  });
  it("gives every menu a module name, a unique key and a link inside its own panel", () => {
    expect(new Set(DEFAULT_MENUS.map((m) => m.key)).size).toBe(DEFAULT_MENUS.length);
    const prefix = { ADMIN: "/admin/", TEACHER: "/office/", STUDENT: "/classroom/" } as const;
    for (const m of DEFAULT_MENUS) {
      expect(m.module.length).toBeGreaterThan(1);
      expect(m.href.startsWith(prefix[m.panel])).toBe(true);
    }
  });
  it("grants only capabilities that exist, and never permissions:manage", () => {
    const granted = Object.values(MENU_GRANTS).flatMap((g) => Object.values(g).flat());
    for (const p of granted) expect(PERMISSIONS).toContain(p);
    expect(granted).not.toContain("permissions:manage");
    expect(permissionsFor("ADMIN_SUPPORT")).not.toContain("permissions:manage");
    expect(permissionsFor("SUPER_ADMIN")).toContain("permissions:manage");
  });
  it("has a capability map for exactly the admin menus", () => {
    expect(Object.keys(MENU_GRANTS).sort()).toEqual(ofPanel("ADMIN").map((m) => m.key).sort());
  });
  it("reads a Menu table row back into a MenuRow", () => {
    const r = toMenuRow({ key: "x", panel: "STUDENT", module: "M", label: "L", href: "/classroom/x", note: null, actions: "access, insert,bogus", displayOrder: 5, active: true });
    expect(r.actions).toEqual(["access", "insert"]);
    expect(toMenuRow({ ...r, panel: "NOPE", actions: "access", note: null }).panel).toBe("ADMIN");
  });
});

describe("admin grid to permissions", () => {
  it("grants nothing for an unticked row, read on Access, decide only on Update", () => {
    expect(permissionsFromGrid([row("admissions")])).toEqual([]);
    expect(permissionsFromGrid([row("admissions", { a: true })])).toEqual(["admissions:read"]);
    expect(permissionsFromGrid([row("admissions", { a: true, u: true })]).sort()).toEqual(["admissions:decide", "admissions:read"]);
  });
  it("splits payments into view/export, verify and refund", () => {
    const p = permissionsFromGrid([row("payments", { a: true, d: true })]);
    expect(p).toContain("payments:refund");
    expect(p).not.toContain("payments:verify");
  });
  it("grants each website-content menu its own permission", () => {
    expect(permissionsFromGrid([row("news", { a: true })])).toEqual(["news:manage"]);
    expect(permissionsFromGrid([row("slider", { a: true })])).toEqual(["slider:manage"]);
  });
  it("ignores teacher or retired menus", () => {
    expect(permissionsFromGrid([row("office.classes", { a: true }), row("retired", { a: true })])).toEqual([]);
  });
});

describe("normalising a submitted row", () => {
  it("drops switches the menu does not offer", () => {
    expect(normaliseGrid(menu("fees"), { access: true, insert: true, update: true, delete: true })).toEqual({ access: true, insert: false, update: false, delete: false });
    expect(normaliseGrid(menu("classroom.videos"), { access: true, update: true }).update).toBe(false);
  });
  it("turns Access on when anything else is ticked", () => {
    expect(normaliseGrid(menu("payments"), { update: true }).access).toBe(true);
    expect(normaliseGrid(menu("office.classes"), { insert: true }).access).toBe(true);
  });
  it("offers what a teacher or student menu declares, and what an admin menu grants", () => {
    expect(offeredFlags(menu("classroom.assignments"))).toEqual(["access", "insert"]);
    expect(offeredFlags(menu("payments"))).toEqual(["access", "update", "delete"]);
  });
});

describe("role defaults", () => {
  it("reproduce an admin role's permissions", () => {
    for (const role of ["ADMIN_SUPPORT", "IT_SUPPORT"] as const) {
      const grid = gridForRole(role, DEFAULT_MENUS);
      const rows = Object.entries(grid).map(([menuKey, g]) => ({ menuKey, canAccess: g.access, canInsert: g.insert, canUpdate: g.update, canDelete: g.delete }));
      const fromGrid = new Set(permissionsFromGrid(rows));
      for (const p of fromGrid) expect(permissionsFor(role)).toContain(p);
      for (const p of permissionsFor(role)) if (Object.values(MENU_GRANTS).some((g) => Object.values(g).flat().includes(p))) expect(fromGrid.has(p)).toBe(true);
    }
  });
  it("give IT support only Users and Support Tickets", () => {
    const ticked = Object.entries(gridForRole("IT_SUPPORT", DEFAULT_MENUS)).filter(([, g]) => g.access).map(([k]) => k).sort();
    expect(ticked).toEqual(["tickets", "users"]);
  });
  it("give teachers and students every switch of every menu in their panel", () => {
    for (const [role, panel] of [["TEACHER", "TEACHER"], ["STUDENT", "STUDENT"]] as const) {
      const grid = gridForRole(role, DEFAULT_MENUS);
      expect(Object.keys(grid).sort()).toEqual(ofPanel(panel).map((m) => m.key).sort());
      for (const m of ofPanel(panel)) for (const f of offeredFlags(m)) expect(grid[m.key]![f]).toBe(true);
    }
  });
});

describe("effective access", () => {
  it("falls back to the role when there is no grid", () => {
    expect(effectiveAccess("ADMIN_SUPPORT", [], DEFAULT_MENUS).permissions).toEqual(permissionsFor("ADMIN_SUPPORT"));
    expect(effectiveAccess("STUDENT", null, DEFAULT_MENUS).menus["classroom.assignments"]).toEqual({ access: true, insert: true, update: false, delete: false });
  });
  it("replaces the role entirely once an admin grid exists", () => {
    const a = effectiveAccess("ADMIN_SUPPORT", [row("tickets", { a: true }), row("admissions")], DEFAULT_MENUS);
    expect(a.permissions).toEqual(["tickets:manage"]);
    expect(a.menus["tickets"]!.access).toBe(true);
    expect(a.menus["admissions"]!.access).toBe(false);
  });
  it("lets a custom grid widen a narrow role", () => {
    expect(effectiveAccess("IT_SUPPORT", [row("payments", { a: true, u: true })], DEFAULT_MENUS).permissions).toContain("payments:verify");
  });
  it("restricts a student or teacher to the menus ticked", () => {
    const s = effectiveAccess("STUDENT", [row("classroom.videos", { a: true })], DEFAULT_MENUS);
    expect(s.menus["classroom.videos"]!.access).toBe(true);
    expect(s.menus["classroom.assignments"]!.access).toBe(false);
    expect(s.permissions).toEqual([]);
  });
  it("treats a menu missing from a saved grid as off, and an inactive menu as unavailable", () => {
    const menus: MenuRow[] = DEFAULT_MENUS.map((m) => (m.key === "office.tasks" ? { ...m, active: false } : m));
    const t = effectiveAccess("TEACHER", [row("office.classes", { a: true })], menus);
    expect(t.menus["office.questions"]!.access).toBe(false);
    expect(t.menus["office.tasks"]).toBeUndefined();
    expect(effectiveAccess("TEACHER", null, menus).menus["office.tasks"]).toBeUndefined();
  });
  it("never restricts a super admin", () => {
    const sa = effectiveAccess("SUPER_ADMIN", [row("tickets")], DEFAULT_MENUS);
    expect(sa.permissions).toEqual(permissionsFor("SUPER_ADMIN"));
    expect(Object.values(sa.menus).every((g) => g.access)).toBe(true);
  });
  it("a saved all-unticked admin grid really locks the user out", () => {
    const a = effectiveAccess("ADMIN_SUPPORT", ofPanel("ADMIN").map((m) => row(m.key)), DEFAULT_MENUS);
    expect(a.permissions).toEqual([]);
  });
  it("knows which panel a role is in", () => {
    expect([panelOfRole("STUDENT"), panelOfRole("TEACHER"), panelOfRole("IT_SUPPORT"), panelOfRole("x")]).toEqual(["STUDENT", "TEACHER", "ADMIN", null]);
  });
});

describe("actor helpers", () => {
  const base: Actor = { userId: 1, loginId: "x", role: "ADMIN_SUPPORT", name: "X", mustChangePassword: false, transport: "cookie" };
  it("actorHas uses resolved permissions, else the role", () => {
    expect(actorHas({ ...base, permissions: ["tickets:manage"] }, "admissions:read")).toBe(false);
    expect(actorHas(base, "admissions:read")).toBe(true);
  });
  it("actorCanOnMenu reads the resolved switches and denies when none were resolved", () => {
    expect(actorCanOnMenu({ ...base, menus: { m: { access: true, insert: false, update: false, delete: false } } }, "m", "access")).toBe(true);
    expect(actorCanOnMenu({ ...base, menus: { m: { access: true, insert: false, update: false, delete: false } } }, "m", "insert")).toBe(false);
    expect(actorCanOnMenu(base, "m", "access")).toBe(false);
  });
  it("maps HTTP methods to switches", () => {
    expect(["GET", "POST", "PATCH", "PUT", "DELETE"].map(flagForMethod)).toEqual(["access", "insert", "update", "update", "delete"]);
  });
});

describe("the menu guard on the student and teacher routes", () => {
  const actor = (role: Actor["role"], menus: Actor["menus"]): Actor => ({ userId: 1, loginId: "x", role, name: "X", mustChangePassword: false, transport: "cookie", menus });
  const grid = (a = false, i = false, u = false) => ({ access: a, insert: i, update: u, delete: false });
  async function run(target: object, handler: string, method: string, a: Actor) {
    const guard = new AuthGuard(new Reflector(), { resolveActor: async () => a } as never);
    const proto = (target as { prototype: Record<string, () => void> }).prototype;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: "/x", method, headers: {}, cookies: {} }) }),
      getHandler: () => proto[handler],
      getClass: () => target,
    } as unknown as ExecutionContext;
    return guard.canActivate(ctx);
  }
  it("lets a student with Access read assignments but not submit without Insert", async () => {
    const s = actor("STUDENT", { "classroom.assignments": grid(true) });
    await expect(run(ClassroomController, "assignments", "GET", s)).resolves.toBe(true);
    await expect(run(ClassroomController, "submit", "POST", s)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(ClassroomController, "submit", "POST", actor("STUDENT", { "classroom.assignments": grid(true, true) }))).resolves.toBe(true);
  });
  it("turns a student away from a menu they have not been given", async () => {
    await expect(run(ClassroomController, "videos", "GET", actor("STUDENT", { "classroom.assignments": grid(true) }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("applies the same rule to teachers, per switch", async () => {
    const t = actor("TEACHER", { "office.classes": grid(true), "office.tasks": grid(true, false, true) });
    await expect(run(OfficeController, "classes", "GET", t)).resolves.toBe(true);
    await expect(run(OfficeController, "attendance", "POST", t)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "toggleTask", "PATCH", t)).resolves.toBe(true);
    await expect(run(OfficeController, "guardians", "GET", t)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("tags every non-public route of both controllers with a menu, except the dashboard and desk status", () => {
    const methods = (c: object) => Object.getOwnPropertyNames((c as { prototype: object }).prototype).filter((n) => n !== "constructor");
    const proto = (c: object) => (c as { prototype: Record<string, () => void> }).prototype;
    const exempt = new Set(["dashboard", "deskStatus", "enrolled", "gameScore", "practiceScore", "student", "teacher"]);
    for (const c of [ClassroomController, OfficeController]) {
      for (const n of methods(c)) {
        if (exempt.has(n)) continue;
        expect(Reflect.getMetadata(REQUIRED_MENU, proto(c)[n]!), `${c.name}.${n} needs @RequireMenu`).toBeTruthy();
      }
    }
    expect(Reflect.getMetadata(ROLES_REQUIRED, ClassroomController)).toEqual(["STUDENT"]);
  });
});

describe("menu entry validation", () => {
  const ok = { key: "classroom.new", panel: "STUDENT", module: "Learning", label: "New thing", href: "/classroom/new" };
  it("accepts a well-formed menu with defaults", () => {
    const m = menuSchema.parse(ok);
    expect(m.actions).toEqual(["access"]);
    expect(m.active).toBe(true);
  });
  it("rejects bad keys and unknown panels, and de-duplicates switches", () => {
    expect(menuSchema.safeParse({ ...ok, key: "Bad Key!" }).success).toBe(false);
    expect(menuSchema.safeParse({ ...ok, panel: "PARENT" }).success).toBe(false);
    expect(menuSchema.parse({ ...ok, actions: ["access", "insert", "access"] }).actions).toEqual(["access", "insert"]);
  });
  it("does not let a menu's key or panel change after it is created", () => {
    expect(menuUpdateSchema.parse({ key: "other", panel: "ADMIN", label: "Renamed" })).toEqual({ label: "Renamed" });
    expect(menuUpdateSchema.parse({ module: "New module" })).toEqual({ module: "New module" });
  });
});
