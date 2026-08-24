import { ROLES, type Role } from "@/common/constants";

/**
 * SEC-4: the single source of truth for what each admin role may do.
 *
 * Before this existed, the admin sidebar computed `isSupport`/`isIT`/`isSuper` to decide
 * which links to render, while every action behind those links called plain
 * `requireAdmin()` — which accepts all three admin roles. Server Actions are directly
 * invocable HTTP endpoints, so an IT_SUPPORT account could verify payments, issue refunds
 * and approve admissions; it simply could not see the buttons.
 *
 * Both the menu (SEC-5) and the server-side guards (SEC-4.1) now read this map, so the
 * two cannot disagree. Adding a module means adding a permission here and nowhere else.
 */

export const PERMISSIONS = [
  "admissions:read",
  "admissions:decide",
  "payments:read",
  "payments:verify",
  "payments:refund",
  "payments:export",
  "fees:manage",
  "content:manage", // CMS pages, news, gallery, student corner, governing body
  "courses:manage",
  "scheduling:manage",
  "reports:manage", // exam results + per-student document generation
  "tickets:manage",
  "users:manage",
  "settings:manage",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Office/admissions staff: everything about applicants, money, content and academics. */
const ADMIN_SUPPORT_PERMISSIONS: Permission[] = [
  "admissions:read",
  "admissions:decide",
  "payments:read",
  "payments:verify",
  "payments:refund",
  "payments:export",
  "fees:manage",
  "content:manage",
  "courses:manage",
  "scheduling:manage",
  "reports:manage",
  "tickets:manage",
];

/** IT support: accounts and the support queue. Deliberately no money, no admissions. */
const IT_SUPPORT_PERMISSIONS: Permission[] = ["users:manage", "tickets:manage"];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  [ROLES.SUPER_ADMIN]: PERMISSIONS,
  [ROLES.ADMIN_SUPPORT]: ADMIN_SUPPORT_PERMISSIONS,
  [ROLES.IT_SUPPORT]: IT_SUPPORT_PERMISSIONS,
  [ROLES.TEACHER]: [],
  [ROLES.STUDENT]: [],
};

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHas(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}

/**
 * SEC-5: admin navigation, derived from the same map the guards use.
 * A link appears only when the role holds the permission its module enforces.
 */
export const ADMIN_NAV: { href: string; label: string; permission: Permission | null }[] = [
  { href: "/admin/dashboard", label: "Dashboard", permission: null },
  { href: "/admin/admissions", label: "Admissions", permission: "admissions:read" },
  { href: "/admin/payments", label: "Payments", permission: "payments:read" },
  { href: "/admin/fees", label: "Fee Configuration", permission: "fees:manage" },
  { href: "/admin/cms", label: "CMS Pages", permission: "content:manage" },
  { href: "/admin/news", label: "News & Events", permission: "content:manage" },
  { href: "/admin/gallery", label: "Media Gallery", permission: "content:manage" },
  { href: "/admin/hero-slider", label: "Homepage Slider", permission: "content:manage" },
  { href: "/admin/student-corner", label: "Student Corner", permission: "content:manage" },
  { href: "/admin/governing", label: "Governing Body", permission: "content:manage" },
  { href: "/admin/courses", label: "Courses & Levels", permission: "courses:manage" },
  { href: "/admin/scheduling", label: "Scheduling", permission: "scheduling:manage" },
  { href: "/admin/users", label: "Users", permission: "users:manage" },
  { href: "/admin/reports", label: "Reports", permission: "reports:manage" },
  { href: "/admin/tickets", label: "Support Tickets", permission: "tickets:manage" },
  { href: "/admin/settings", label: "Settings", permission: "settings:manage" },
  { href: "/admin/audit", label: "Audit Log", permission: "audit:read" },
];

export function navFor(role: Role) {
  return ADMIN_NAV.filter((item) => item.permission === null || roleHas(role, item.permission));
}
