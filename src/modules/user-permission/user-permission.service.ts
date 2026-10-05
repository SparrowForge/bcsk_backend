import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { notFound, unprocessable } from "../../common/errors/app-error";
import type { Role } from "../../common/constants";
import type { Actor } from "../../common/actor";
import {
  CUSTOMISABLE_ROLES, MENU_FLAGS, PERMISSION_MENUS, gridForRole, normaliseGrid, type MenuGrid,
} from "../../common/menu-permissions";

export type GridInput = Record<string, Partial<MenuGrid>>;

/**
 * Per-user menu permissions. Only super admins reach this (`permissions:manage` is in no other
 * role's list and not in any menu's grants, so it cannot be granted to anyone).
 */
@Injectable()
export class UserPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The menus and which of the four switches each one offers - the grid's shape. */
  catalog() {
    return PERMISSION_MENUS.map((m) => ({
      key: m.key,
      module: m.module,
      label: m.label,
      note: m.note ?? null,
      offers: Object.fromEntries(MENU_FLAGS.map((f) => [f, (m.grants[f]?.length ?? 0) > 0])) as Record<string, boolean>,
    }));
  }

  /** Staff whose menus can be customised, and whether they already have a custom grid. */
  async users() {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: [...CUSTOMISABLE_ROLES] }, active: true },
      select: { id: true, loginId: true, name: true, role: true, _count: { select: { menuPermissions: true } } },
      orderBy: { name: "asc" },
    });
    return rows.map((u) => ({ id: u.id, loginId: u.loginId, name: u.name, role: u.role, custom: u._count.menuPermissions > 0 }));
  }

  private async customisable(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } });
    if (!user) throw notFound("User");
    if (!CUSTOMISABLE_ROLES.includes(user.role as Role)) {
      throw unprocessable("Only office admin and IT support accounts have menu permissions. Super admins always have full access.");
    }
    return user;
  }

  /** The grid a user is on now: their saved one, or - marked `custom: false` - their role's defaults. */
  async forUser(userId: number) {
    const user = await this.customisable(userId);
    const rows = await this.prisma.userMenuPermission.findMany({ where: { userId } });
    if (rows.length === 0) return { custom: false, role: user.role, grid: gridForRole(user.role as Role) };
    const grid: Record<string, MenuGrid> = {};
    for (const m of PERMISSION_MENUS) {
      const r = rows.find((x) => x.menuKey === m.key);
      grid[m.key] = r
        ? { access: r.canAccess, insert: r.canInsert, update: r.canUpdate, delete: r.canDelete }
        : { access: false, insert: false, update: false, delete: false };
    }
    return { custom: true, role: user.role, grid };
  }

  /** "Import role": a role's defaults as a grid to start from. Nothing is saved. */
  forRole(role: string) {
    if (!CUSTOMISABLE_ROLES.includes(role as Role) && role !== "SUPER_ADMIN") {
      throw unprocessable("That role has no admin menus.");
    }
    return { role, grid: gridForRole(role as Role) };
  }

  /** Give every listed user exactly this grid. One row per menu, so an all-unticked grid is a real lock-down. */
  async save(userIds: number[], input: GridInput, actor: Actor) {
    const ids = [...new Set(userIds)];
    for (const id of ids) await this.customisable(id);

    const unknown = Object.keys(input).filter((k) => !PERMISSION_MENUS.some((m) => m.key === k));
    if (unknown.length) throw unprocessable(`Unknown menu: ${unknown.join(", ")}.`);

    const data = ids.flatMap((userId) =>
      PERMISSION_MENUS.map((m) => {
        const g = normaliseGrid(m, input[m.key] ?? {});
        return { userId, menuKey: m.key, canAccess: g.access, canInsert: g.insert, canUpdate: g.update, canDelete: g.delete };
      }),
    );
    await this.prisma.$transaction([
      this.prisma.userMenuPermission.deleteMany({ where: { userId: { in: ids } } }),
      this.prisma.userMenuPermission.createMany({ data }),
    ]);
    await this.audit.record(actor.userId, "MENU_PERMISSIONS_SET", "User", ids.join(","), `${ids.length} user(s)`);
    return { updated: ids.length };
  }

  /** Put users back on their role's default permissions. */
  async clear(userIds: number[], actor: Actor) {
    const ids = [...new Set(userIds)];
    const res = await this.prisma.userMenuPermission.deleteMany({ where: { userId: { in: ids } } });
    await this.audit.record(actor.userId, "MENU_PERMISSIONS_CLEAR", "User", ids.join(","), `${ids.length} user(s)`);
    return { cleared: ids.length, rows: res.count };
  }
}
