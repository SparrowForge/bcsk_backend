import { ADMIN_ROLES, type Role } from "@/common/constants";
import { roleHas, type Permission } from "@/common/permissions";
import { forbidden, unauthenticated } from "@/common/errors/app-error";

/**
 * Who is performing an operation, independent of how they proved it.
 *
 * A service receives an `Actor`; it never reads a cookie, a header, or a request. That is what
 * lets the same service back a web page, a Server Action, a mobile API call, and a CLI script
 * without knowing the difference — and it is what makes services testable without HTTP.
 *
 * `transport` is recorded for logging and audit only. **No authorisation decision may branch
 * on it**: a capability the web can exercise is one the mobile app can exercise, or the two
 * surfaces have quietly diverged, which is exactly the class of bug SEC-4 was.
 */
export type ActorTransport = "cookie" | "bearer" | "system";

export type Actor = {
  userId: number;
  loginId: string;
  role: Role;
  name: string;
  /** SEC-2: credential was issued by the office and has not yet been replaced by its holder. */
  mustChangePassword: boolean;
  transport: ActorTransport;
};

/** An unauthenticated caller. Public reads accept this; everything else must reject it. */
export type MaybeActor = Actor | null;

/**
 * The system itself — seeds, migrations, scheduled jobs. Holds no role and therefore no
 * permission, so a job cannot accidentally perform a staff-only action without saying so.
 */
export const SYSTEM_ACTOR: Actor = {
  userId: 0,
  loginId: "system",
  role: "SUPER_ADMIN",
  name: "System",
  mustChangePassword: false,
  transport: "system",
};

export const isStaff = (actor: MaybeActor): actor is Actor =>
  actor !== null && ADMIN_ROLES.includes(actor.role);

export const isStudent = (actor: MaybeActor): actor is Actor => actor?.role === "STUDENT";
export const isTeacher = (actor: MaybeActor): actor is Actor => actor?.role === "TEACHER";

export const can = (actor: MaybeActor, permission: Permission): boolean =>
  actor !== null && roleHas(actor.role, permission);

/** Narrow to an authenticated actor or throw. */
export function requireActor(actor: MaybeActor): Actor {
  if (!actor) throw unauthenticated();
  return actor;
}

/**
 * Narrow to an actor holding `permission`, or throw. The service-layer equivalent of
 * `requirePermission()` — same map, same answer, no HTTP involved.
 */
export function requireCan(actor: MaybeActor, permission: Permission): Actor {
  const a = requireActor(actor);
  if (!roleHas(a.role, permission)) {
    throw forbidden("Your role doesn't have access to this.", { permission });
  }
  return a;
}

/**
 * Assert the actor owns the record, or holds a capability that overrides ownership.
 * Encodes the pattern used across the classroom and office surfaces: a student may read
 * their own submission; a teacher or staff member may read anyone's.
 */
export function requireOwnerOr(
  actor: MaybeActor,
  ownerUserId: number,
  override: Permission
): Actor {
  const a = requireActor(actor);
  if (a.userId === ownerUserId || roleHas(a.role, override)) return a;
  throw forbidden();
}
