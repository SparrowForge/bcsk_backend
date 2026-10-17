import { describe, it, expect } from "vitest";
import { AdminService, cornerKindKey } from "../src/modules/admin/admin.service";

/**
 * October 2026 design update: every news item carries a picture, and Student Corner takes any
 * kind of extra-curricular work rather than four fixed ones. Database-free: in-memory
 * stand-ins for the two delegates, implementing only the calls the service makes.
 */
type Row = Record<string, unknown> & { id: number };

function fakeDelegate(seed: Row[] = []) {
  let rows = [...seed];
  let nextId = rows.length + 1;
  return {
    rows: () => rows,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId++, ...data };
      rows.push(row);
      return row;
    },
    // Prisma skips an undefined field on update; the stand-in must too, or the test would
    // pass for the wrong reason.
    update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      rows = rows.map((r) => (r.id === where.id ? { ...r, ...defined } : r));
      return rows.find((r) => r.id === where.id)!;
    },
  };
}

function service(seed: { news?: Row[]; corner?: Row[] } = {}) {
  const eventNews = fakeDelegate(seed.news);
  const studentCornerPost = fakeDelegate(seed.corner);
  const audit = { record: async () => undefined };
  const svc = new AdminService({ eventNews, studentCornerPost } as never, audit as never, {} as never, {} as never);
  return { svc, news: eventNews.rows, corner: studentCornerPost.rows };
}

const actor = { userId: 1, role: "SUPER_ADMIN" } as never;
const newsInput = { type: "EVENT", title: "Sports day", body: "Races and prizes.", date: "2026-10-01", published: true };
const cornerInput = { title: "Clay pot", body: "Made in class.", studentName: "Rafi, Class 3", published: true };

describe("Student Corner kinds", () => {
  it("turns whatever the admin typed into one stable key", () => {
    expect(cornerKindKey("Handy crafts")).toBe("HANDY_CRAFTS");
    expect(cornerKindKey("  handy-crafts ")).toBe("HANDY_CRAFTS");
    expect(cornerKindKey("POEM")).toBe("POEM");
    expect(cornerKindKey("Science & Projects!")).toBe("SCIENCE_PROJECTS");
  });

  it("keeps letters in any script", () => {
    expect(cornerKindKey("হস্তশিল্প")).not.toBe("");
  });

  it("refuses a kind with nothing usable in it", async () => {
    const { svc } = service();
    await expect(svc.saveCornerPost({ ...cornerInput, kind: "  --  " }, actor)).rejects.toThrow(/kind/i);
  });

  it("stores a new kind and its picture", async () => {
    const { svc, corner } = service();
    await svc.saveCornerPost({ ...cornerInput, kind: "Handicraft", imageUrl: "/api/files/gallery/pot.jpg" }, actor);
    expect(corner()[0]).toMatchObject({ kind: "HANDICRAFT", imageUrl: "/api/files/gallery/pot.jpg" });
  });

  it("keeps the picture when an edit does not touch it, and removes it on null", async () => {
    const { svc, corner } = service({
      corner: [{ id: 1, ...cornerInput, kind: "ARTWORK", imageUrl: "/api/files/gallery/a.jpg" }],
    });
    await svc.saveCornerPost({ id: 1, ...cornerInput, title: "Renamed", kind: "ARTWORK" }, actor);
    expect(corner()[0]).toMatchObject({ title: "Renamed", imageUrl: "/api/files/gallery/a.jpg" });
    await svc.saveCornerPost({ id: 1, ...cornerInput, kind: "ARTWORK", imageUrl: null }, actor);
    expect(corner()[0].imageUrl).toBeNull();
  });
});

describe("news pictures", () => {
  it("stores the picture with the item", async () => {
    const { svc, news } = service();
    await svc.saveNews({ ...newsInput, imageUrl: "/api/files/gallery/race.jpg" }, actor);
    expect(news()[0]).toMatchObject({ title: "Sports day", imageUrl: "/api/files/gallery/race.jpg" });
  });

  it("keeps the picture when an edit does not touch it", async () => {
    const { svc, news } = service({ news: [{ id: 1, ...newsInput, imageUrl: "/api/files/gallery/race.jpg" }] });
    await svc.saveNews({ id: 1, ...newsInput, title: "Sports day 2026" }, actor);
    expect(news()[0]).toMatchObject({ title: "Sports day 2026", imageUrl: "/api/files/gallery/race.jpg" });
  });
});
