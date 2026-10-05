import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { log, errMessage } from "./logger";
import { DEFAULT_MENUS, MENU_FLAGS, PANELS, type MenuFlag, type MenuRow, type Panel } from "./menu-permissions";

const TTL_MS = 30_000;

/** A `Menu` table row as Prisma returns it. */
type DbMenu = {
  key: string; panel: string; module: string; label: string; href: string; note: string | null;
  actions: string; displayOrder: number; active: boolean;
};

export function toMenuRow(m: DbMenu): MenuRow {
  return {
    key: m.key,
    panel: (PANELS as readonly string[]).includes(m.panel) ? (m.panel as Panel) : "ADMIN",
    module: m.module,
    label: m.label,
    href: m.href,
    note: m.note,
    actions: m.actions.split(",").map((a) => a.trim()).filter((a): a is MenuFlag => (MENU_FLAGS as readonly string[]).includes(a)),
    displayOrder: m.displayOrder,
    active: m.active,
  };
}

/**
 * The menus, read from the `Menu` table and held for a few seconds so resolving a request's
 * access (which needs them) is not a query per request. Writes through `MenuService` call
 * `invalidate()`; another instance sees a change within the TTL.
 *
 * If the table cannot be read (for example before the migration has run) it falls back to the
 * built-in catalog rather than locking everyone out.
 */
@Injectable()
export class MenuCatalogService implements OnModuleInit {
  private cache: { at: number; menus: MenuRow[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.ensureSeeded();
    } catch (e) {
      log.warn("config", "menu_seed_skipped", { error: errMessage(e) });
    }
  }

  /**
   * Insert any built-in menu that is missing. Never updates an existing row, so names, modules
   * and order edited on the Menu entry screen survive a restart.
   */
  async ensureSeeded() {
    await this.prisma.menu.createMany({
      data: DEFAULT_MENUS.map((m) => ({
        key: m.key, panel: m.panel, module: m.module, label: m.label, href: m.href, note: m.note,
        actions: m.actions.join(","), displayOrder: m.displayOrder, active: m.active,
      })),
      skipDuplicates: true,
    });
    this.invalidate();
  }

  invalidate() {
    this.cache = null;
  }

  /** Every menu, active or not, in display order. */
  async all(): Promise<MenuRow[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.menus;
    try {
      const rows = await this.prisma.menu.findMany({ orderBy: [{ panel: "asc" }, { displayOrder: "asc" }, { id: "asc" }] });
      const menus = rows.map(toMenuRow);
      this.cache = { at: Date.now(), menus };
      return menus;
    } catch (e) {
      log.warn("config", "menu_table_unreadable", { error: errMessage(e) });
      return DEFAULT_MENUS;
    }
  }
}
