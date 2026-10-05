import { permissionsFor, type Permission } from "./permissions";
import type { Role } from "./constants";

/**
 * Menus and who may use them - the logic behind the `Menu` and `UserMenuPermission` tables.
 *
 * A *menu* is one page-group of one of the three panels (admin, teacher, student). Each has four
 * switches - Access, Insert, Update, Delete - and a user is granted any subset.
 *
 *  - **Teacher and student menus** are enforced by key: a route says `@RequireMenu("assignments")`
 *    and the guard checks the matching switch for the request (GET = Access, POST = Insert,
 *    PATCH/PUT = Update, DELETE = Delete). A user with no saved grid gets every switch the menu
 *    offers.
 *  - **Admin menus** map each switch to the capability strings the admin guards already enforce
 *    (`MENU_GRANTS`), so ticking a cell adds exactly those permissions. Those strings are
 *    enforcement logic, so they live here in code and are deliberately not editable as data;
 *    the `Menu` table holds the rest (name, module, link, order). A switch an admin menu has no
 *    capability for is simply not offered. Insert / Update / Delete exist only where the backend
 *    already separates them (Admissions decide; Payments verify / refund; CRM manage); the rest
 *    are all-or-nothing through Access.
 *
 * Dashboards are not menus: every account of a panel always reaches its own landing page.
 */
export const MENU_FLAGS = ["access", "insert", "update", "delete"] as const;
export type MenuFlag = (typeof MENU_FLAGS)[number];
export type MenuGrid = Record<MenuFlag, boolean>;

export const PANELS = ["ADMIN", "TEACHER", "STUDENT"] as const;
export type Panel = (typeof PANELS)[number];

/** The panel a role belongs to, or null for a role with no panel. */
export const panelOfRole = (role: string): Panel | null =>
  role === "STUDENT" ? "STUDENT" : role === "TEACHER" ? "TEACHER" : ["ADMIN_SUPPORT", "IT_SUPPORT", "SUPER_ADMIN"].includes(role) ? "ADMIN" : null;

/** Where each panel lives, to check a menu's link belongs to its panel. */
export const PANEL_PREFIX: Record<Panel, string> = { ADMIN: "/admin/", TEACHER: "/office/", STUDENT: "/classroom/" };

/** A menu as stored in the `Menu` table. */
export type MenuRow = {
  key: string;
  panel: Panel;
  module: string;
  label: string;
  href: string;
  note: string | null;
  /** The switches this menu offers (admin menus: derived from MENU_GRANTS instead). */
  actions: MenuFlag[];
  displayOrder: number;
  active: boolean;
};

type Seed = Omit<MenuRow, "displayOrder" | "active" | "actions" | "note"> & { note?: string; actions?: MenuFlag[] };

/** What each admin menu's switches grant. Not data: see the header. */
export const MENU_GRANTS: Record<string, Partial<Record<MenuFlag, readonly Permission[]>>> = {
  admissions: { access: ["admissions:read"], update: ["admissions:decide"] },
  payments: { access: ["payments:read", "payments:export"], update: ["payments:verify"], delete: ["payments:refund"] },
  fees: { access: ["fees:manage"] },
  coupons: { access: ["coupons:manage"] },
  leads: { access: ["leads:read"], update: ["leads:manage"] },
  tickets: { access: ["tickets:manage"] },
  cms: { access: ["cms:manage"] },
  news: { access: ["news:manage"] },
  gallery: { access: ["gallery:manage"] },
  slider: { access: ["slider:manage"] },
  corner: { access: ["corner:manage"] },
  governing: { access: ["governing:manage"] },
  courses: { access: ["courses:manage"] },
  scheduling: { access: ["scheduling:manage"] },
  reports: { access: ["reports:manage"] },
  users: { access: ["users:manage"] },
  settings: { access: ["settings:manage"] },
  audit: { access: ["audit:read"] },
};

/**
 * Every current menu. The migration seeds these into the `Menu` table and `MenuCatalogService`
 * inserts any that are missing at startup; it never overwrites a row, so edits made on the
 * Menu entry screen (names, modules, order) survive.
 */
const SEEDS: Seed[] = [
  // ---------------------------------------------------------------- admin
  { key: "admissions", panel: "ADMIN", module: "Admissions & Fees", label: "Admissions", href: "/admin/admissions", note: "Update = approve / reject / request corrections" },
  { key: "payments", panel: "ADMIN", module: "Admissions & Fees", label: "Payments", href: "/admin/payments", note: "Access includes CSV export; Update = verify; Delete = refund" },
  { key: "fees", panel: "ADMIN", module: "Admissions & Fees", label: "Fee Configuration", href: "/admin/fees" },
  { key: "coupons", panel: "ADMIN", module: "Admissions & Fees", label: "Coupons", href: "/admin/coupons" },
  { key: "leads", panel: "ADMIN", module: "CRM", label: "CRM Leads", href: "/admin/leads", note: "Update = create, edit, assign, convert and delete leads and sources" },
  { key: "tickets", panel: "ADMIN", module: "CRM", label: "Support Tickets", href: "/admin/tickets" },
  { key: "cms", panel: "ADMIN", module: "Website Content", label: "CMS Pages", href: "/admin/cms" },
  { key: "news", panel: "ADMIN", module: "Website Content", label: "News & Events", href: "/admin/news" },
  { key: "gallery", panel: "ADMIN", module: "Website Content", label: "Media Gallery", href: "/admin/gallery" },
  { key: "slider", panel: "ADMIN", module: "Website Content", label: "Homepage Slider", href: "/admin/hero-slider" },
  { key: "corner", panel: "ADMIN", module: "Website Content", label: "Student Corner", href: "/admin/student-corner" },
  { key: "governing", panel: "ADMIN", module: "Website Content", label: "Governing Body", href: "/admin/governing" },
  { key: "courses", panel: "ADMIN", module: "Academics", label: "Courses & Levels", href: "/admin/courses" },
  { key: "scheduling", panel: "ADMIN", module: "Academics", label: "Scheduling", href: "/admin/scheduling" },
  { key: "reports", panel: "ADMIN", module: "Academics", label: "Reports", href: "/admin/reports", note: "Exam results and student documents" },
  { key: "users", panel: "ADMIN", module: "Administration", label: "Users", href: "/admin/users" },
  { key: "settings", panel: "ADMIN", module: "Administration", label: "Settings", href: "/admin/settings" },
  { key: "audit", panel: "ADMIN", module: "Administration", label: "Audit Log", href: "/admin/audit" },
  // -------------------------------------------------------------- teacher
  { key: "office.classes", panel: "TEACHER", module: "Teaching", label: "My Classes", href: "/office/classes", note: "Insert = attendance, assignments, videos, grading; Update = go live / end class", actions: ["access", "insert", "update"] },
  { key: "office.questions", panel: "TEACHER", module: "Teaching", label: "Questions", href: "/office/questions", note: "Insert = answer a question", actions: ["access", "insert"] },
  { key: "office.tasks", panel: "TEACHER", module: "Teaching", label: "Task List", href: "/office/tasks", note: "Update = tick a task done", actions: ["access", "update"] },
  { key: "office.guardians", panel: "TEACHER", module: "Students & Guardians", label: "Guardians", href: "/office/guardians", actions: ["access"] },
  // -------------------------------------------------------------- student
  { key: "classroom.assignments", panel: "STUDENT", module: "Learning", label: "Assignments", href: "/classroom/assignments", note: "Insert = submit work", actions: ["access", "insert"] },
  { key: "classroom.videos", panel: "STUDENT", module: "Learning", label: "Class Videos", href: "/classroom/videos", actions: ["access"] },
  { key: "classroom.routine", panel: "STUDENT", module: "Learning", label: "Routine", href: "/classroom/routine", actions: ["access"] },
  { key: "classroom.syllabus", panel: "STUDENT", module: "Learning", label: "Syllabus", href: "/classroom/syllabus", actions: ["access"] },
  { key: "classroom.results", panel: "STUDENT", module: "Progress", label: "Results", href: "/classroom/results", actions: ["access"] },
  { key: "classroom.attendance", panel: "STUDENT", module: "Progress", label: "Attendance", href: "/classroom/attendance", actions: ["access"] },
  { key: "classroom.documents", panel: "STUDENT", module: "Account", label: "Documents", href: "/classroom/documents", actions: ["access"] },
  { key: "classroom.payments", panel: "STUDENT", module: "Account", label: "Payments", href: "/classroom/payments", actions: ["access"] },
  { key: "classroom.re-admission", panel: "STUDENT", module: "Account", label: "Re-Admission", href: "/classroom/re-admission", note: "Insert = submit the re-admission payment", actions: ["access", "insert"] },
  { key: "classroom.ask-teacher", panel: "STUDENT", module: "Support", label: "Ask Teacher", href: "/classroom/ask-teacher", note: "Insert = send a question", actions: ["access", "insert"] },
];

export const DEFAULT_MENUS: MenuRow[] = SEEDS.map((s, i) => ({
  key: s.key,
  panel: s.panel,
  module: s.module,
  label: s.label,
  href: s.href,
  note: s.note ?? null,
  actions: s.panel === "ADMIN" ? MENU_FLAGS.filter((f) => (MENU_GRANTS[s.key]?.[f]?.length ?? 0) > 0) : (s.actions ?? ["access"]),
  displayOrder: i * 10,
  active: true,
}));

/** Roles whose menus can be customised. SUPER_ADMIN always holds everything and is never restricted. */
export const CUSTOMISABLE_ROLES: readonly Role[] = ["ADMIN_SUPPORT", "IT_SUPPORT", "TEACHER", "STUDENT"];

const emptyGrid = (): MenuGrid => ({ access: false, insert: false, update: false, delete: false });

/** The switches a menu actually offers: admin menus from their capability map, the others as stored. */
export function offeredFlags(menu: Pick<MenuRow, "key" | "panel" | "actions">): MenuFlag[] {
  if (menu.panel === "ADMIN") return MENU_FLAGS.filter((f) => (MENU_GRANTS[menu.key]?.[f]?.length ?? 0) > 0);
  return MENU_FLAGS.filter((f) => menu.actions.includes(f));
}

/**
 * Make a submitted row coherent: only switches the menu offers survive, and any granted switch
 * implies Access (a menu you can act in but not open is unreachable).
 */
export function normaliseGrid(menu: Pick<MenuRow, "key" | "panel" | "actions">, grid: Partial<MenuGrid>): MenuGrid {
  const offered = offeredFlags(menu);
  const out = emptyGrid();
  for (const f of MENU_FLAGS) out[f] = !!grid[f] && offered.includes(f);
  if ((out.insert || out.update || out.delete) && offered.includes("access")) out.access = true;
  return out;
}

type Row = { menuKey: string; canAccess: boolean; canInsert: boolean; canUpdate: boolean; canDelete: boolean };

const toGrid = (r: Row): MenuGrid => ({ access: r.canAccess, insert: r.canInsert, update: r.canUpdate, delete: r.canDelete });

/** The capabilities a set of admin grid rows grants: the union of every ticked, offered cell. */
export function permissionsFromGrid(rows: Row[]): Permission[] {
  const out = new Set<Permission>();
  for (const row of rows) {
    const grants = MENU_GRANTS[row.menuKey];
    if (!grants) continue; // not an admin menu, or one retired from the catalog: grants nothing
    const on = toGrid(row);
    for (const f of MENU_FLAGS) if (on[f]) for (const p of grants[f] ?? []) out.add(p);
  }
  return [...out];
}

/** A role's defaults as a grid over `menus`: admin roles from their permissions, the others fully on. */
export function gridForRole(role: Role, menus: MenuRow[]): Record<string, MenuGrid> {
  const panel = panelOfRole(role);
  const held = new Set<string>(permissionsFor(role));
  const grid: Record<string, MenuGrid> = {};
  for (const menu of menus.filter((m) => m.panel === panel)) {
    const row = emptyGrid();
    for (const f of offeredFlags(menu)) {
      if (panel === "ADMIN") {
        const needs = MENU_GRANTS[menu.key]?.[f] ?? [];
        row[f] = needs.length > 0 && needs.every((p) => held.has(p));
      } else {
        row[f] = true;
      }
    }
    grid[menu.key] = row;
  }
  return grid;
}

export type Access = {
  /** Capabilities for the admin guards (empty for teachers and students). */
  permissions: readonly Permission[];
  /** The switches this person holds on each active menu of their own panel. */
  menus: Record<string, MenuGrid>;
};

/**
 * What a user may do: their saved grid if they have one, otherwise their role's defaults.
 * SUPER_ADMIN ignores any rows - it can never be locked out. Inactive menus are unavailable to
 * everyone but a super admin.
 */
export function effectiveAccess(role: Role, rows: Row[] | null | undefined, allMenus: MenuRow[]): Access {
  const panel = panelOfRole(role);
  const menus = allMenus.filter((m) => m.panel === panel && m.active);
  const custom = !!rows && rows.length > 0 && CUSTOMISABLE_ROLES.includes(role);

  if (role === "SUPER_ADMIN") {
    return { permissions: permissionsFor(role), menus: Object.fromEntries(menus.map((m) => [m.key, fullGrid(m)])) };
  }
  if (!custom) {
    return { permissions: permissionsFor(role), menus: gridForRole(role, menus) };
  }
  const byKey = new Map(rows!.map((r) => [r.menuKey, r]));
  const grid: Record<string, MenuGrid> = {};
  for (const m of menus) {
    const r = byKey.get(m.key);
    grid[m.key] = r ? normaliseGrid(m, toGrid(r)) : emptyGrid();
  }
  return { permissions: panel === "ADMIN" ? permissionsFromGrid(rows!) : [], menus: grid };
}

function fullGrid(m: MenuRow): MenuGrid {
  const g = emptyGrid();
  for (const f of offeredFlags(m)) g[f] = true;
  return g;
}

/** Which switch an HTTP method needs. */
export function flagForMethod(method: string): MenuFlag {
  switch (method.toUpperCase()) {
    case "POST": return "insert";
    case "PUT":
    case "PATCH": return "update";
    case "DELETE": return "delete";
    default: return "access";
  }
}
