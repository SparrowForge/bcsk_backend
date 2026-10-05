import { describe, it, expect } from "vitest";
import {
  MENU_KEYS, PERMISSION_MENUS, effectivePermissions, gridForRole, normaliseGrid, permissionsFromGrid,
} from "../src/common/menu-permissions";
import { PERMISSIONS, permissionsFor } from "../src/common/permissions";
import { actorHas, type Actor } from "../src/common/actor";

const row = (menuKey: string, f: Partial<{ a: boolean; i: boolean; u: boolean; d: boolean }> = {}) => ({
  menuKey, canAccess: !!f.a, canInsert: !!f.i, canUpdate: !!f.u, canDelete: !!f.d,
});
const menu = (k: string) => PERMISSION_MENUS.find((m) => m.key === k)!;

describe("menu catalog", () => {
  it("only grants capabilities that exist", () => {
    for (const m of PERMISSION_MENUS) for (const perms of Object.values(m.grants)) for (const p of perms!) expect(PERMISSIONS).toContain(p);
  });
  it("can never grant permissions:manage, so only a super admin can hand out permissions", () => {
    const granted = PERMISSION_MENUS.flatMap((m) => Object.values(m.grants).flat());
    expect(granted).not.toContain("permissions:manage");
    expect(permissionsFor("ADMIN_SUPPORT")).not.toContain("permissions:manage");
    expect(permissionsFor("IT_SUPPORT")).not.toContain("permissions:manage");
    expect(permissionsFor("SUPER_ADMIN")).toContain("permissions:manage");
  });
  it("has unique keys", () => {
    expect(new Set(MENU_KEYS).size).toBe(MENU_KEYS.length);
  });
});

describe("grid to permissions", () => {
  it("grants nothing for an unticked row", () => {
    expect(permissionsFromGrid([row("admissions")])).toEqual([]);
  });
  it("grants read on Access and decide only on Update", () => {
    expect(permissionsFromGrid([row("admissions", { a: true })])).toEqual(["admissions:read"]);
    expect(permissionsFromGrid([row("admissions", { a: true, u: true })]).sort()).toEqual(["admissions:decide", "admissions:read"]);
  });
  it("splits payments into view/export, verify and refund", () => {
    const p = permissionsFromGrid([row("payments", { a: true, d: true })]);
    expect(p).toContain("payments:refund");
    expect(p).not.toContain("payments:verify");
  });
  it("ignores a menu that is no longer in the catalog", () => {
    expect(permissionsFromGrid([row("retired", { a: true, u: true })])).toEqual([]);
  });
});

describe("normalising a submitted row", () => {
  it("drops flags the menu does not offer", () => {
    const g = normaliseGrid(menu("fees"), { access: true, insert: true, update: true, delete: true });
    expect(g).toEqual({ access: true, insert: false, update: false, delete: false });
  });
  it("turns Access on when anything else is ticked", () => {
    expect(normaliseGrid(menu("payments"), { update: true }).access).toBe(true);
  });
});

describe("role defaults as a grid", () => {
  it("reproduces what the role can do", () => {
    for (const role of ["ADMIN_SUPPORT", "IT_SUPPORT"] as const) {
      const grid = gridForRole(role);
      const rows = Object.entries(grid).map(([menuKey, g]) => ({ menuKey, canAccess: g.access, canInsert: g.insert, canUpdate: g.update, canDelete: g.delete }));
      const fromGrid = new Set(permissionsFromGrid(rows));
      // Everything the grid says the role can do, the role really can; and no menu capability is lost.
      for (const p of fromGrid) expect(permissionsFor(role)).toContain(p);
      for (const p of permissionsFor(role)) if (PERMISSION_MENUS.some((m) => Object.values(m.grants).flat().includes(p))) expect(fromGrid.has(p)).toBe(true);
    }
  });
  it("gives IT support only Users and Support Tickets", () => {
    const ticked = Object.entries(gridForRole("IT_SUPPORT")).filter(([, g]) => g.access).map(([k]) => k).sort();
    expect(ticked).toEqual(["tickets", "users"]);
  });
});

describe("effective permissions", () => {
  it("falls back to the role when there is no grid", () => {
    expect(effectivePermissions("ADMIN_SUPPORT", [])).toEqual(permissionsFor("ADMIN_SUPPORT"));
    expect(effectivePermissions("ADMIN_SUPPORT", null)).toEqual(permissionsFor("ADMIN_SUPPORT"));
  });
  it("replaces the role entirely once a grid exists", () => {
    const p = effectivePermissions("ADMIN_SUPPORT", [row("tickets", { a: true }), row("admissions")]);
    expect(p).toEqual(["tickets:manage"]);
  });
  it("lets a custom grid widen a narrow role", () => {
    const p = effectivePermissions("IT_SUPPORT", [row("payments", { a: true, u: true })]);
    expect(p).toContain("payments:verify");
  });
  it("never restricts a super admin or touches non-admin roles", () => {
    expect(effectivePermissions("SUPER_ADMIN", [row("tickets")])).toEqual(permissionsFor("SUPER_ADMIN"));
    expect(effectivePermissions("STUDENT", [row("payments", { a: true })])).toEqual([]);
  });
  it("a saved all-unticked grid really locks the user out", () => {
    expect(effectivePermissions("ADMIN_SUPPORT", MENU_KEYS.map((k) => row(k)))).toEqual([]);
  });
});

describe("actorHas", () => {
  const base: Actor = { userId: 1, loginId: "x", role: "ADMIN_SUPPORT", name: "X", mustChangePassword: false, transport: "cookie" };
  it("uses the resolved permissions when present", () => {
    expect(actorHas({ ...base, permissions: ["tickets:manage"] }, "admissions:read")).toBe(false);
    expect(actorHas({ ...base, permissions: ["tickets:manage"] }, "tickets:manage")).toBe(true);
  });
  it("falls back to the role when none were resolved", () => {
    expect(actorHas(base, "admissions:read")).toBe(true);
  });
});
