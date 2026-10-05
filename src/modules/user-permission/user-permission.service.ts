import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { MenuCatalogService } from "../../common/menu-catalog.service";
import { notFound, unprocessable } from "../../common/errors/app-error";
import type { Role } from "../../common/constants";
import type { Actor } from "../../common/actor";
import {
  CUSTOMISABLE_ROLES, MENU_FLAGS, gridForRole, normaliseGrid, offeredFlags, panelOfRole,
  type MenuGrid, type MenuRow, type Panel,
} from "../../common/menu-permissions";

export type GridInput = Record<string, Partial<MenuGrid>>;

const panelName: Record<Panel, string> = { ADMIN: "admin", TEACHER: "teacher", STUDENT: "student" };

/**
 * Per-user menu permissions for admin, teacher and student accounts. Only super admins reach
 * this (`permissions:manage` is in no other role's list and no menu grants it).
 */
@Injectable()
export class UserPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly menus: MenuCatalogService,
  ) {}

  /** The active menus of one panel, with the switches each offers - the grid's shape. */
  async catalog(panel?: Panel) {
    const all = (await this.menus.all()).filter((m) => m.active && (!panel || m.panel === panel));
    return all.map((m) => ({
      key: m.key,
      panel: m.panel,
      module: m.module,
      label: m.label,
      note: m.note,
      offers: Object.fromEntries(MENU_FLAGS.map((f) => [f, offeredFlags(m).includes(f)])) as Record<string, boolean>,
    }));
  }

  /** Accounts whose menus can be customised, with their panel and whether they have a custom grid. */
  async users() {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: [...CUSTOMISABLE_ROLES] }, active: true },
      select: { id: true, loginId: true, name: true, role: true, _count: { select: { menuPermissions: true } } },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    return rows.map((u) => ({
      id: u.id, loginId: u.loginId, name: u.name, role: u.role, panel: panelOfRole(u.role)!, custom: u._count.menuPermissions > 0,
    }));
  }

  private async customisable(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw notFound("User");
    if (!CUSTOMISABLE_ROLES.includes(user.role as Role)) {
      throw unprocessable("Super admins always have full access, so there is nothing to customise.");
    }
    return { id: user.id, role: user.role as Role, panel: panelOfRole(user.role)! };
  }

  private async panelMenus(panel: Panel): Promise<MenuRow[]> {
    return (await this.menus.all()).filter((m) => m.active && m.panel === panel);
  }

  /** The grid a user is on now: their saved one, or - marked `custom: false` - their role's defaults. */
  async forUser(userId: number) {
    const user = await this.customisable(userId);
    const menus = await this.panelMenus(user.panel);
    const rows = await this.prisma.userMenuPermission.findMany({ where: { userId }, include: { menu: { select: { key: true } } } });
    if (rows.length === 0) return { custom: false, role: user.role, panel: user.panel, grid: gridForRole(user.role, menus) };
    const grid: Record<string, MenuGrid> = {};
    for (const m of menus) {
      const r = rows.find((x) => x.menu.key === m.key);
      grid[m.key] = r
        ? normaliseGrid(m, { access: r.canAccess, insert: r.canInsert, update: r.canUpdate, delete: r.canDelete })
        : { access: false, insert: false, update: false, delete: false };
    }
    return { custom: true, role: user.role, panel: user.panel, grid };
  }

  /** "Import role": a role's defaults as a grid to start from. Nothing is saved. */
  async forRole(role: string) {
    const panel = panelOfRole(role);
    if (!panel) throw unprocessable("That role has no menus.");
    const menus = await this.panelMenus(panel);
    return { role, panel, grid: gridForRole(role as Role, menus) };
  }

  /**
   * Give every listed user exactly this grid. All users must belong to one panel (a teacher and an
   * admin do not share menus). One row per menu, so an all-unticked grid is a real lock-down.
   */
  async save(userIds: number[], input: GridInput, actor: Actor) {
    const ids = [...new Set(userIds)];
    const users = await Promise.all(ids.map((id) => this.customisable(id)));
    const panels = new Set(users.map((u) => u.panel));
    if (panels.size > 1) {
      throw unprocessable(`Pick users from one panel at a time (selected: ${[...panels].map((p) => panelName[p]).join(", ")}).`);
    }
    const panel = users[0]!.panel;
    const menus = await this.panelMenus(panel);
    const dbMenus = await this.prisma.menu.findMany({ where: { key: { in: menus.map((m) => m.key) } }, select: { id: true, key: true } });
    const idOf = new Map(dbMenus.map((m) => [m.key, m.id]));

    const unknown = Object.keys(input).filter((k) => !menus.some((m) => m.key === k));
    if (unknown.length) throw unprocessable(`Not a ${panelName[panel]} menu: ${unknown.join(", ")}.`);

    const data = ids.flatMap((userId) =>
      menus.map((m) => {
        const g = normaliseGrid(m, input[m.key] ?? {});
        return { userId, menuId: idOf.get(m.key)!, canAccess: g.access, canInsert: g.insert, canUpdate: g.update, canDelete: g.delete };
      }),
    );
    await this.prisma.$transaction([
      this.prisma.userMenuPermission.deleteMany({ where: { userId: { in: ids } } }),
      this.prisma.userMenuPermission.createMany({ data }),
    ]);
    await this.audit.record(actor.userId, "MENU_PERMISSIONS_SET", "User", ids.join(","), `${ids.length} ${panelName[panel]} user(s)`);
    return { updated: ids.length, panel };
  }

  /** Put users back on their role's default permissions. */
  async clear(userIds: number[], actor: Actor) {
    const ids = [...new Set(userIds)];
    const res = await this.prisma.userMenuPermission.deleteMany({ where: { userId: { in: ids } } });
    await this.audit.record(actor.userId, "MENU_PERMISSIONS_CLEAR", "User", ids.join(","), `${ids.length} user(s)`);
    return { cleared: ids.length, rows: res.count };
  }
}
