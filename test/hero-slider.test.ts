import { describe, it, expect } from "vitest";
import { AdminService } from "../src/modules/admin/admin.service";

/**
 * Homepage slider rules: order and on/off are the admin's, but at most HERO_ACTIVE_LIMIT
 * images rotate at once and at most HERO_IMAGE_LIMIT are stored. Database-free: an in-memory
 * stand-in for the `heroImage` delegate, implementing only the calls the service makes.
 */
type Row = { id: number; url: string; caption: string | null; displayOrder: number; active: boolean };

function fakeDb(seed: Partial<Row>[] = []) {
  let rows: Row[] = seed.map((r, i) => ({
    id: i + 1, url: `/api/files/gallery/${i + 1}.jpg`, caption: null, displayOrder: i + 1, active: true, ...r,
  }));
  let nextId = rows.length + 1;
  const match = (r: Row, where?: { active?: boolean; id?: { not: number } }) =>
    (where?.active === undefined || r.active === where.active) && (where?.id?.not === undefined || r.id !== where.id.not);
  const heroImage = {
    count: async (args?: { where?: { active?: boolean; id?: { not: number } } }) => rows.filter((r) => match(r, args?.where)).length,
    findFirst: async () => [...rows].sort((a, b) => b.displayOrder - a.displayOrder)[0] ?? null,
    findUnique: async ({ where }: { where: { id: number } }) => rows.find((r) => r.id === where.id) ?? null,
    findMany: async (args?: { where?: { active?: boolean } }) =>
      rows.filter((r) => match(r, args?.where)).sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id),
    create: async ({ data }: { data: Omit<Row, "id"> }) => {
      const row = { id: nextId++, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
      const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      rows = rows.map((r) => (r.id === where.id ? { ...r, ...defined } : r));
      return rows.find((r) => r.id === where.id)!;
    },
  };
  const audit = { record: async () => undefined };
  const svc = new AdminService({ heroImage } as never, audit as never, {} as never, {} as never);
  return { svc, rows: () => rows };
}

const actor = { userId: 1, role: "SUPER_ADMIN" } as never;
const five = Array.from({ length: AdminService.HERO_ACTIVE_LIMIT }, () => ({}));

describe("homepage slider", () => {
  it("adds an image at the order given, inactive when asked", async () => {
    const { svc } = fakeDb();
    const img = await svc.addHeroImage("/api/files/gallery/a.jpg", "Sports day", { displayOrder: 3, active: false }, actor);
    expect(img).toMatchObject({ displayOrder: 3, active: false, caption: "Sports day" });
  });

  it("puts an image with no order after the last one", async () => {
    const { svc } = fakeDb([{ displayOrder: 7 }]);
    const img = await svc.addHeroImage("/api/files/gallery/b.jpg", null, {}, actor);
    expect(img.displayOrder).toBe(8);
    expect(img.active).toBe(true);
  });

  it("refuses a sixth active image but accepts it inactive", async () => {
    const { svc } = fakeDb(five);
    await expect(svc.addHeroImage("/api/files/gallery/c.jpg", null, { active: true }, actor)).rejects.toThrow(/at most 5/i);
    await expect(svc.addHeroImage("/api/files/gallery/c.jpg", null, { active: false }, actor)).resolves.toMatchObject({ active: false });
  });

  it("refuses to switch an image on when the active slots are full", async () => {
    const { svc } = fakeDb([...five, { active: false }]);
    await expect(svc.updateHeroImage(6, { active: true }, actor)).rejects.toThrow(/at most 5/i);
  });

  it("lets an already-active image be saved again when the slots are full", async () => {
    const { svc } = fakeDb(five);
    await expect(svc.updateHeroImage(1, { active: true, displayOrder: 9, caption: "  " }, actor)).resolves.toMatchObject({
      active: true, displayOrder: 9, caption: null,
    });
  });

  it("shows only active images on the homepage, lowest order first", async () => {
    const { svc } = fakeDb([
      { displayOrder: 3 },
      { displayOrder: 1, active: false },
      { displayOrder: 2 },
    ]);
    const shown = await svc.publicHeroImages();
    expect(shown.map((r) => r.id)).toEqual([3, 1]);
  });

  it("caps how many images are stored, active or not", async () => {
    const { svc } = fakeDb(Array.from({ length: AdminService.HERO_IMAGE_LIMIT }, () => ({ active: false })));
    await expect(svc.addHeroImage("/api/files/gallery/d.jpg", null, { active: false }, actor)).rejects.toThrow(/stores at most/i);
  });
});
