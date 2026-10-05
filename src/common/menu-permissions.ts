import { permissionsFor, type Permission } from "./permissions";
import type { Role } from "./constants";

/**
 * The admin menus a super admin can grant, one row of the "User Menu Permission" grid each.
 *
 * Every switch maps to the capability strings the guards already enforce, so a grid cell is
 * never decorative: ticking it adds exactly those permissions, and the API refuses the call
 * without them. A flag a menu has no matching capability for is simply not offered (`grants`
 * omits it) - the backend rejects it rather than storing a cell that would do nothing.
 *
 *  - Access  opens the menu (read-level capability).
 *  - Insert / Update / Delete  are offered only where the backend already separates them
 *    (Admissions decide; Payments verify / refund; CRM manage). Menus guarded by a single
 *    "manage" capability grant it all through Access.
 *
 * Menus are grouped by capability, not by sidebar link: "Website Content" is one row because
 * CMS, News, Gallery, Slider, Student Corner and Governing Body share `content:manage`, and a
 * grid that offered them separately would promise isolation the API does not provide.
 */
export const MENU_FLAGS = ["access", "insert", "update", "delete"] as const;
export type MenuFlag = (typeof MENU_FLAGS)[number];
export type MenuGrid = Record<MenuFlag, boolean>;

export type PermissionMenu = {
  key: string;
  module: string;
  label: string;
  /** What else sits behind this row, shown under its name. */
  note?: string;
  grants: Partial<Record<MenuFlag, readonly Permission[]>>;
};

export const PERMISSION_MENUS: readonly PermissionMenu[] = [
  { key: "admissions", module: "Admissions & Fees", label: "Admissions", note: "Update = approve / reject / request corrections", grants: { access: ["admissions:read"], update: ["admissions:decide"] } },
  { key: "payments", module: "Admissions & Fees", label: "Payments", note: "Access includes CSV export; Update = verify; Delete = refund", grants: { access: ["payments:read", "payments:export"], update: ["payments:verify"], delete: ["payments:refund"] } },
  { key: "fees", module: "Admissions & Fees", label: "Fee Configuration", grants: { access: ["fees:manage"] } },
  { key: "coupons", module: "Admissions & Fees", label: "Coupons", grants: { access: ["coupons:manage"] } },
  { key: "leads", module: "CRM", label: "CRM Leads", note: "Update = create, edit, assign, convert and delete leads and sources", grants: { access: ["leads:read"], update: ["leads:manage"] } },
  { key: "tickets", module: "CRM", label: "Support Tickets", grants: { access: ["tickets:manage"] } },
  { key: "content", module: "Website & Academics", label: "Website Content", note: "CMS pages, News & Events, Gallery, Slider, Student Corner, Governing Body", grants: { access: ["content:manage"] } },
  { key: "courses", module: "Website & Academics", label: "Courses & Levels", grants: { access: ["courses:manage"] } },
  { key: "scheduling", module: "Website & Academics", label: "Scheduling", grants: { access: ["scheduling:manage"] } },
  { key: "reports", module: "Website & Academics", label: "Reports", note: "Exam results and student documents", grants: { access: ["reports:manage"] } },
  { key: "users", module: "Administration", label: "Users", grants: { access: ["users:manage"] } },
  { key: "settings", module: "Administration", label: "Settings", grants: { access: ["settings:manage"] } },
  { key: "audit", module: "Administration", label: "Audit Log", grants: { access: ["audit:read"] } },
];

export const MENU_KEYS = PERMISSION_MENUS.map((m) => m.key);

/** Roles whose menus can be customised. SUPER_ADMIN always holds everything and is never restricted. */
export const CUSTOMISABLE_ROLES: readonly Role[] = ["ADMIN_SUPPORT", "IT_SUPPORT"];

const emptyGrid = (): MenuGrid => ({ access: false, insert: false, update: false, delete: false });

/** A menu flag a row actually offers. */
export const offers = (menu: PermissionMenu, flag: MenuFlag) => (menu.grants[flag]?.length ?? 0) > 0;

/**
 * Make a submitted row coherent: only flags the menu offers survive, and any granted flag
 * implies Access (a menu you can edit but not open is unreachable).
 */
export function normaliseGrid(menu: PermissionMenu, grid: Partial<MenuGrid>): MenuGrid {
  const out = emptyGrid();
  for (const f of MENU_FLAGS) out[f] = !!grid[f] && offers(menu, f);
  if (out.insert || out.update || out.delete) out.access = offers(menu, "access");
  return out;
}

/** The capabilities a set of grid rows grants: the union of every ticked, offered cell. */
export function permissionsFromGrid(rows: { menuKey: string; canAccess: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean }[]): Permission[] {
  const out = new Set<Permission>();
  for (const row of rows) {
    const menu = PERMISSION_MENUS.find((m) => m.key === row.menuKey);
    if (!menu) continue; // a menu retired from the catalog grants nothing
    const on: Record<MenuFlag, boolean> = { access: row.canAccess, insert: row.canInsert, update: row.canUpdate, delete: row.canDelete };
    for (const f of MENU_FLAGS) if (on[f]) for (const p of menu.grants[f] ?? []) out.add(p);
  }
  return [...out];
}

/** A role's defaults expressed as a grid: a cell is ticked when the role holds everything it grants. */
export function gridForRole(role: Role): Record<string, MenuGrid> {
  const held = new Set(permissionsFor(role));
  const grid: Record<string, MenuGrid> = {};
  for (const menu of PERMISSION_MENUS) {
    const row = emptyGrid();
    for (const f of MENU_FLAGS) {
      const needs = menu.grants[f];
      row[f] = !!needs && needs.length > 0 && needs.every((p) => held.has(p));
    }
    grid[menu.key] = row;
  }
  return grid;
}

/**
 * What a user may do: their saved grid if they have one, otherwise their role's defaults.
 * SUPER_ADMIN and non-admin roles ignore any rows - the first can never be locked out, the
 * others have no admin capabilities to customise.
 */
export function effectivePermissions(
  role: Role,
  rows: { menuKey: string; canAccess: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean }[] | null | undefined,
): readonly Permission[] {
  if (!rows || rows.length === 0 || !CUSTOMISABLE_ROLES.includes(role)) return permissionsFor(role);
  return permissionsFromGrid(rows);
}
