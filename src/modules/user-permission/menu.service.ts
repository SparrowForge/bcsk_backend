import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { MenuCatalogService, toMenuRow } from "../../common/menu-catalog.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import type { Actor } from "../../common/actor";
import { DEFAULT_MENUS, MENU_FLAGS, PANELS, PANEL_PREFIX, offeredFlags } from "../../common/menu-permissions";

const flags = z.array(z.enum(MENU_FLAGS)).min(1).transform((a) => [...new Set(a)]);

const fields = {
  key: z.string().trim().toLowerCase().min(2).max(50).regex(/^[a-z0-9][a-z0-9._-]*$/, "Lower-case letters, numbers, . _ - only."),
  panel: z.enum(PANELS),
  module: z.string().trim().min(2).max(60),
  label: z.string().trim().min(2).max(60),
  href: z.string().trim().min(2).max(200),
  note: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
  actions: flags,
  displayOrder: z.coerce.number().int().min(0).max(100000),
  active: z.boolean(),
};

export const menuSchema = z.object({ ...fields, actions: fields.actions.default(["access"]), displayOrder: fields.displayOrder.default(0), active: fields.active.default(true) });
/**
 * An update carries only what changed. It is built from the fields without their defaults:
 * `.partial()` on the create schema would still fill them in and silently reset a menu's order,
 * switches and active flag on every edit. `key` and `panel` identify a menu and what its routes
 * and grants mean, so they are fixed once created.
 */
export const menuUpdateSchema = z.object(fields).omit({ key: true, panel: true }).partial();

export type MenuInput = z.infer<typeof menuSchema>;
export type MenuUpdate = z.infer<typeof menuUpdateSchema>;

const BUILT_IN = new Set(DEFAULT_MENUS.map((m) => m.key));

/**
 * Menu entry: add and edit the rows of the `Menu` table. Names, modules, links and order are
 * data. What an *admin* menu's switches grant is code, so an admin menu cannot be created or
 * switched off here (it would grant nothing, or strand a capability), and a teacher or student
 * menu only does something once a page or route is wired to its key.
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly catalog: MenuCatalogService,
  ) {}

  async list() {
    const rows = await this.prisma.menu.findMany({
      orderBy: [{ panel: "asc" }, { displayOrder: "asc" }, { id: "asc" }],
      include: { _count: { select: { permissions: true } } },
    });
    return rows.map((r) => {
      const menu = toMenuRow(r);
      return { ...menu, id: r.id, offers: offeredFlags(menu), builtIn: BUILT_IN.has(r.key), assigned: r._count.permissions };
    });
  }

  private assertHref(panel: (typeof PANELS)[number], href: string) {
    if (!href.startsWith(PANEL_PREFIX[panel]) || href.includes("//") || href.includes("..")) {
      throw unprocessable(`The link must be a page of the ${panel.toLowerCase()} panel (start with ${PANEL_PREFIX[panel]}).`);
    }
  }

  async create(input: MenuInput, actor: Actor) {
    if (input.panel === "ADMIN") {
      throw unprocessable("Admin menus are tied to capabilities in code, so a new one cannot be added here. Edit an existing admin menu instead.");
    }
    this.assertHref(input.panel, input.href);
    try {
      const row = await this.prisma.menu.create({ data: { ...input, actions: input.actions.join(",") } });
      this.catalog.invalidate();
      await this.audit.record(actor.userId, "MENU_CREATE", "Menu", row.id, row.key);
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("A menu with that key already exists.");
      throw e;
    }
  }

  async update(id: number, input: MenuUpdate, actor: Actor) {
    const existing = await this.prisma.menu.findUnique({ where: { id } });
    if (!existing) throw notFound("Menu");
    const panel = existing.panel as (typeof PANELS)[number];
    if (input.href !== undefined) this.assertHref(panel, input.href);
    if (panel === "ADMIN" && input.active === false) {
      throw unprocessable("An admin menu cannot be switched off here: its capabilities would stay granted. Remove it from users' grids instead.");
    }
    if (panel === "ADMIN" && input.actions !== undefined) {
      throw unprocessable("An admin menu's switches come from the capabilities it grants and cannot be changed here.");
    }
    const { actions, ...rest } = input;
    const row = await this.prisma.menu.update({
      where: { id },
      data: { ...rest, ...(actions ? { actions: actions.join(",") } : {}) },
    });
    this.catalog.invalidate();
    await this.audit.record(actor.userId, "MENU_EDIT", "Menu", id, row.key);
    return row;
  }

  /** Only a menu added on this screen can be deleted; the built-in ones are re-created at startup anyway. */
  async remove(id: number, actor: Actor) {
    const row = await this.prisma.menu.findUnique({ where: { id } });
    if (!row) throw notFound("Menu");
    if (BUILT_IN.has(row.key)) {
      throw unprocessable("A built-in menu cannot be deleted. Switch it off instead (teacher and student menus) or leave it.");
    }
    await this.prisma.menu.delete({ where: { id } });
    this.catalog.invalidate();
    await this.audit.record(actor.userId, "MENU_DELETE", "Menu", id, row.key);
    return { ok: true };
  }
}
