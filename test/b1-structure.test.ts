import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import { ROLES_REQUIRED } from "../src/common/decorators/actor.decorator";
import { ADMIN_ROLES, type Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { planBackfill, sectionKeyString, subjectCode, type PlanInput } from "../src/modules/structure/backfill-plan";
import { assertTeaches } from "../src/modules/structure/teaching-scope";
import { autoPlace, placeInSection } from "../src/modules/structure/section-placement";
import { StructureController } from "../src/modules/structure/structure.controller";
import { InstitutesController, OwnInstituteController } from "../src/modules/structure/institute.controller";
import { StructureService } from "../src/modules/structure/structure.service";
import { termSchema, curriculumSchema, departmentSchema } from "../src/modules/structure/structure.schema";
import { OfficeController } from "../src/modules/office/office.controller";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";

const actorOf = (role: Role, instituteId = 1): Actor => ({
  userId: 7, loginId: "x", role, name: "X", instituteId, mustChangePassword: false, transport: "cookie",
});

async function run(target: object, handlerName: string, actor: Actor | null, method = "GET") {
  const guard = new AuthGuard(new Reflector(), { resolveActor: async () => actor } as never);
  const proto = (target as { prototype: Record<string, () => void> }).prototype;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ originalUrl: "/x", method, headers: {}, cookies: {} }) }),
    getHandler: () => proto[handlerName],
    getClass: () => target,
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

/* ------------------------------------------------------------------ backfill plan */

const base: PlanInput = {
  levels: [
    { id: 1, courseId: 100, code: "PRE_PRIMARY", name: "Pre-Primary" },
    { id: 2, courseId: 100, code: "CLASS_1", name: "Class 1" },
    { id: 3, courseId: 100, code: "CLASS_2", name: "Class 2" },
    { id: 10, courseId: 200, code: null, name: "Level 0" },
  ],
  regularCourseIds: [100],
  courses: [
    { id: 100, slug: "regular-course", name: "Regular Course" },
    { id: 101, slug: "bangla", name: "Bangla" },
    { id: 102, slug: "english", name: "English" },
    { id: 200, slug: "abacus", name: "Abacus" },
  ],
  sessions: [
    { id: 1, title: "Class 2 - Bangla", courseId: 101, courseLevelId: null, classLevel: "CLASS_2", semester: "2026-2", teacherId: 50, active: true },
    { id: 2, title: "Class 2 - English", courseId: 102, courseLevelId: null, classLevel: "CLASS_2", semester: "2026-2", teacherId: 51, active: true },
    { id: 3, title: "Pre-Primary A - Bangla", courseId: 101, courseLevelId: null, classLevel: "PRE_PRIMARY_A", semester: "2026-2", teacherId: 50, active: true },
    { id: 4, title: "Pre-Primary B - Bangla", courseId: 101, courseLevelId: null, classLevel: "PRE_PRIMARY_B", semester: "2026-2", teacherId: 52, active: true },
    { id: 5, title: "Abacus Level 0", courseId: 200, courseLevelId: 10, classLevel: null, semester: "2026-2", teacherId: 53, active: true },
    { id: 6, title: "Orphan", courseId: 101, courseLevelId: null, classLevel: "CLASS_9", semester: "2026-2", teacherId: null, active: true },
  ],
  enrollments: [
    { studentUserId: 900, classSessionId: 1, semester: "2026-2", status: "ACTIVE" },
    { studentUserId: 900, classSessionId: 2, semester: "2026-2", status: "ACTIVE" },
    { studentUserId: 901, classSessionId: 1, semester: "2026-2", status: "ACTIVE" },
    { studentUserId: 900, classSessionId: 5, semester: "2026-2", status: "ACTIVE" },
    { studentUserId: 902, classSessionId: 3, semester: "2026-2", status: "ACTIVE" },
    { studentUserId: 902, classSessionId: 4, semester: "2026-2", status: "ACTIVE" },
    { studentUserId: 903, classSessionId: 1, semester: "2026-1", status: "CANCELLED" },
  ],
  studentNames: { 900: "Zara", 901: "Arif", 902: "Mina" },
  currentTerm: "2026-2",
};

describe("B1 backfill plan", () => {
  const plan = planBackfill(base);
  const section = (sessionId: number) => plan.sessionLinks.find((l) => l.sessionId === sessionId)?.key;

  it("maps a regular session to the Regular Course level with its code, section A", () => {
    expect(section(1)).toEqual({ levelId: 3, term: "2026-2", section: "A" });
  });
  it("reads a section suffix on the class code as the section name", () => {
    expect(section(3)).toEqual({ levelId: 1, term: "2026-2", section: "A" });
    expect(section(4)).toEqual({ levelId: 1, term: "2026-2", section: "B" });
  });
  it("maps a special-course session to its own level", () => {
    expect(section(5)).toEqual({ levelId: 10, term: "2026-2", section: "A" });
  });
  it("reports a session it cannot place instead of guessing", () => {
    expect(plan.unplacedSessions).toEqual([{ sessionId: 6, title: "Orphan", reason: "no regular class has the code CLASS_9" }]);
  });
  it("makes one subject per course taught, and one curriculum row per class and subject", () => {
    expect(plan.subjects.map((s) => s.code).sort()).toEqual(["ABACUS", "BANGLA", "ENGLISH"]);
    expect(plan.curriculum).toHaveLength(4); // Class 2: Bangla, English; Pre-Primary: Bangla; Abacus L0: Abacus
  });
  it("assigns each session's teacher to its section and subject", () => {
    expect(plan.assignments).toHaveLength(5);
    expect(plan.assignments).toContainEqual({ teacherProfileId: 52, key: { levelId: 1, term: "2026-2", section: "B" }, courseId: 101 });
  });
  it("places each student once per batch and numbers rolls by name", () => {
    const class2 = plan.placements.filter((p) => sectionKeyString(p.key) === "3|2026-2|A");
    expect(class2).toEqual([
      { studentUserId: 901, key: { levelId: 3, term: "2026-2", section: "A" }, rollNo: 1 },
      { studentUserId: 900, key: { levelId: 3, term: "2026-2", section: "A" }, rollNo: 2 },
    ]);
    // Zara is also in Abacus: a different batch, so a second place.
    expect(plan.placements.filter((p) => p.studentUserId === 900)).toHaveLength(2);
  });
  it("keeps the first section when a student is enrolled in two of one batch, and reports it", () => {
    expect(plan.placements.filter((p) => p.studentUserId === 902)).toHaveLength(1);
    expect(plan.placementConflicts).toEqual([{ studentUserId: 902, kept: "1|2026-2|A", dropped: "1|2026-2|B" }]);
  });
  it("counts enrolled students per term to check placement against, ignoring cancelled ones", () => {
    expect(plan.enrolledStudentsByTerm).toEqual({ "2026-2": 3 });
    expect(plan.terms).toEqual([{ code: "2026-1", isCurrent: false }, { code: "2026-2", isCurrent: true }]);
  });
  it("derives subject codes that fit the 20-character limit", () => {
    expect(subjectCode("ielts-for-kids")).toBe("IELTS-FOR-KIDS");
    expect(subjectCode("a-very-long-course-slug-indeed").length).toBe(20);
  });
});

/* ------------------------------------------------------------------ teaching scope */

function scopePrisma(opts: { profileId?: number; classTeacherId?: number | null; sectionInInstitute?: boolean; assignment?: boolean }) {
  return {
    teacherProfile: { findUnique: vi.fn(async () => (opts.profileId ? { id: opts.profileId } : null)) },
    section: { findFirst: vi.fn(async () => (opts.sectionInInstitute === false ? null : { classTeacherId: opts.classTeacherId ?? null })) },
    teacherAssignment: { findFirst: vi.fn(async () => (opts.assignment ? { id: 1 } : null)) },
  };
}

describe("assertTeaches", () => {
  const teacher = actorOf("TEACHER");
  it("lets an assigned teacher in for their subject", async () => {
    const p = scopePrisma({ profileId: 5, assignment: true });
    await expect(assertTeaches(p as never, teacher, 10, 3)).resolves.toEqual({ teacherProfileId: 5, isClassTeacher: false });
  });
  it("lets the class teacher in for section-wide work, but not for a subject they do not teach", async () => {
    await expect(assertTeaches(scopePrisma({ profileId: 5, classTeacherId: 5 }) as never, teacher, 10)).resolves.toMatchObject({ isClassTeacher: true });
    await expect(assertTeaches(scopePrisma({ profileId: 5, classTeacherId: 5 }) as never, teacher, 10, 3)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("refuses a teacher with no tie to the section", async () => {
    await expect(assertTeaches(scopePrisma({ profileId: 5, classTeacherId: 9 }) as never, teacher, 10)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("answers not found for another institute's section", async () => {
    const p = scopePrisma({ profileId: 5, sectionInInstitute: false, assignment: true });
    await expect(assertTeaches(p as never, teacher, 10)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(p.section.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10, batch: { term: { instituteId: 1 } } } }));
  });
  it("refuses an account with no teacher profile", async () => {
    await expect(assertTeaches(scopePrisma({}) as never, teacher, 10)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* ------------------------------------------------------------------ section placement */

type Row = { id: number; studentUserId: number; sectionId: number; batchId: number; rollNo: number | null; status: string };

function placementTx(sections: { id: number; batchId: number; capacity: number | null; active?: boolean; name?: string }[], rows: Row[] = [], current = true) {
  const activeIn = (sectionId: number) => rows.filter((r) => r.sectionId === sectionId && r.status === "ACTIVE").length;
  const withCount = (s: (typeof sections)[number]) => ({ ...s, active: s.active ?? true, _count: { enrollments: activeIn(s.id) } });
  return {
    rows,
    tx: {
      section: { findUnique: async ({ where }: { where: { id: number } }) => { const s = sections.find((x) => x.id === where.id); return s ? withCount(s) : null; } },
      sectionEnrollment: {
        findUnique: async ({ where }: { where: Record<string, { studentUserId?: number; batchId?: number; sectionId?: number; rollNo?: number }> }) => {
          if (where.studentUserId_batchId) return rows.find((r) => r.studentUserId === where.studentUserId_batchId!.studentUserId && r.batchId === where.studentUserId_batchId!.batchId) ?? null;
          return rows.find((r) => r.sectionId === where.sectionId_rollNo!.sectionId && r.rollNo === where.sectionId_rollNo!.rollNo) ?? null;
        },
        aggregate: async ({ where }: { where: { sectionId: number } }) => ({ _max: { rollNo: Math.max(0, ...rows.filter((r) => r.sectionId === where.sectionId).map((r) => r.rollNo ?? 0)) || null } }),
        create: async ({ data }: { data: Omit<Row, "id" | "status"> }) => { const r = { ...data, id: rows.length + 1, status: "ACTIVE" }; rows.push(r); return r; },
        update: async ({ where, data }: { where: { id: number }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      },
      academicTerm: { findFirst: async () => (current ? { id: 1 } : null) },
      batch: {
        findUnique: async () => ({
          sections: sections.filter((s) => s.active ?? true).sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")).map(withCount),
        }),
      },
    },
  };
}

describe("section placement", () => {
  it("gives a new student the next roll number", async () => {
    const { tx, rows } = placementTx([{ id: 1, batchId: 9, capacity: null }], [
      { id: 1, studentUserId: 1, sectionId: 1, batchId: 9, rollNo: 4, status: "ACTIVE" },
    ]);
    const row = await placeInSection(tx as never, { studentUserId: 2, sectionId: 1 });
    expect(row).toMatchObject({ sectionId: 1, rollNo: 5 });
    expect(rows).toHaveLength(2);
  });
  it("moves a student between sections of a batch instead of adding a second place", async () => {
    const { tx, rows } = placementTx([{ id: 1, batchId: 9, capacity: null }, { id: 2, batchId: 9, capacity: null }], [
      { id: 1, studentUserId: 1, sectionId: 1, batchId: 9, rollNo: 3, status: "ACTIVE" },
    ]);
    await placeInSection(tx as never, { studentUserId: 1, sectionId: 2 });
    expect(rows).toEqual([{ id: 1, studentUserId: 1, sectionId: 2, batchId: 9, rollNo: 1, status: "ACTIVE" }]);
  });
  it("refuses a full section and a taken roll number", async () => {
    const { tx } = placementTx([{ id: 1, batchId: 9, capacity: 1 }], [
      { id: 1, studentUserId: 1, sectionId: 1, batchId: 9, rollNo: 1, status: "ACTIVE" },
    ]);
    await expect(placeInSection(tx as never, { studentUserId: 2, sectionId: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    const open = placementTx([{ id: 1, batchId: 9, capacity: null }], [
      { id: 1, studentUserId: 1, sectionId: 1, batchId: 9, rollNo: 1, status: "ACTIVE" },
    ]);
    await expect(placeInSection(open.tx as never, { studentUserId: 2, sectionId: 1, rollNo: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses a closed section", async () => {
    const { tx } = placementTx([{ id: 1, batchId: 9, capacity: null, active: false }]);
    await expect(placeInSection(tx as never, { studentUserId: 2, sectionId: 1 })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
  it("at admission, picks the open section with the fewest students", async () => {
    const { tx } = placementTx(
      [{ id: 1, batchId: 9, capacity: null, name: "A" }, { id: 2, batchId: 9, capacity: null, name: "B" }],
      [
        { id: 1, studentUserId: 1, sectionId: 1, batchId: 9, rollNo: 1, status: "ACTIVE" },
        { id: 2, studentUserId: 2, sectionId: 1, batchId: 9, rollNo: 2, status: "ACTIVE" },
        { id: 3, studentUserId: 3, sectionId: 2, batchId: 9, rollNo: 1, status: "ACTIVE" },
      ],
    );
    expect(await autoPlace(tx as never, { studentUserId: 4, courseLevelId: 5, instituteId: 1 })).toMatchObject({ sectionId: 2, rollNo: 2 });
  });
  it("at admission, places no one when there is no current term or every section is full", async () => {
    expect(await autoPlace(placementTx([{ id: 1, batchId: 9, capacity: null }], [], false).tx as never, { studentUserId: 4, courseLevelId: 5, instituteId: 1 })).toBeNull();
    const full = placementTx([{ id: 1, batchId: 9, capacity: 1 }], [{ id: 1, studentUserId: 1, sectionId: 1, batchId: 9, rollNo: 1, status: "ACTIVE" }]);
    expect(await autoPlace(full.tx as never, { studentUserId: 4, courseLevelId: 5, instituteId: 1 })).toBeNull();
  });
});

/* ------------------------------------------------------------------ institute isolation in the service */

describe("structure service stays inside the actor's institute", () => {
  it("bounds every list to the institute", async () => {
    const calls: unknown[] = [];
    const spy = (args: unknown) => { calls.push(args); return Promise.resolve([]); };
    const prisma = {
      department: { findMany: spy }, academicTerm: { findMany: spy }, subject: { findMany: spy },
      batch: { findMany: spy }, section: { findMany: spy }, teacherProfile: { findMany: spy }, user: { findMany: spy },
      course: { findMany: spy },
    };
    const svc = new StructureService(prisma as never, { record: vi.fn() } as never);
    const a = actorOf("HEAD_MASTER", 4);
    await Promise.all([
      svc.departments(a), svc.terms(a), svc.subjects(a), svc.levels(a), svc.batches(a), svc.sections(a, {}),
      svc.teachers(a), svc.students(a, {}),
    ]);
    const text = JSON.stringify(calls);
    expect(calls).toHaveLength(8);
    expect(text.match(/"instituteId":4/g)?.length).toBe(8);
    expect(text).not.toMatch(/"instituteId":(?!4)\d/);
  });
  it("refuses to hang a section on another institute's teacher", async () => {
    const prisma = {
      batch: { findFirst: vi.fn(async () => ({ id: 1 })) },
      teacherProfile: { findFirst: vi.fn(async () => null) },
      section: { create: vi.fn() },
    };
    const svc = new StructureService(prisma as never, { record: vi.fn() } as never);
    await expect(svc.createSection(actorOf("HEAD_MASTER"), { batchId: 1, name: "A", capacity: null, room: null, classTeacherId: 99, active: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.section.create).not.toHaveBeenCalled();
  });
  it("refuses to assign a teacher a subject the class does not study", async () => {
    const prisma = {
      section: { findFirst: vi.fn(async () => ({ id: 1, name: "A", batch: { courseLevelId: 3, termId: 1 } })) },
      teacherProfile: { findFirst: vi.fn(async () => ({ id: 5, user: { name: "T" } })) },
      subject: { findFirst: vi.fn(async () => ({ id: 2, name: "Science", instituteId: 1 })) },
      curriculumSubject: { findUnique: vi.fn(async () => null) },
      teacherAssignment: { create: vi.fn() },
    };
    const svc = new StructureService(prisma as never, { record: vi.fn() } as never);
    await expect(svc.assignTeacher(actorOf("HEAD_MASTER"), 1, 5, 2)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.teacherAssignment.create).not.toHaveBeenCalled();
  });
  it("will not delete a term that has classes", async () => {
    const prisma = {
      academicTerm: { findFirst: vi.fn(async () => ({ id: 1, code: "2026-2" })), delete: vi.fn() },
      batch: { count: vi.fn(async () => 3) },
    };
    const svc = new StructureService(prisma as never, { record: vi.fn() } as never);
    await expect(svc.deleteTerm(actorOf("HEAD_MASTER"), 1)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.academicTerm.delete).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ routes and guards */

describe("B1 routes", () => {
  const rolesOf = (c: object) => Reflect.getMetadata(ROLES_REQUIRED, c) as Role[] | undefined;
  it("keeps the structure and institute screens on the admin panel", () => {
    expect(rolesOf(StructureController)).toEqual(ADMIN_ROLES);
    expect(rolesOf(OwnInstituteController)).toEqual(ADMIN_ROLES);
    expect(rolesOf(InstitutesController)).toEqual(["SUPER_ADMIN"]);
  });
  it("lets the Head Master manage structure and their own institute, but not other institutes", async () => {
    await expect(run(StructureController, "sections", actorOf("HEAD_MASTER"))).resolves.toBe(true);
    await expect(run(StructureController, "createSubject", actorOf("HEAD_MASTER"), "POST")).resolves.toBe(true);
    await expect(run(OwnInstituteController, "updateOwn", actorOf("HEAD_MASTER"), "PATCH")).resolves.toBe(true);
    await expect(run(InstitutesController, "create", actorOf("HEAD_MASTER"), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(InstitutesController, "create", actorOf("SUPER_ADMIN"), "POST")).resolves.toBe(true);
  });
  it("keeps office and IT staff out of the structure screens", async () => {
    for (const role of ["ADMIN_SUPPORT", "IT_SUPPORT"] as Role[]) {
      await expect(run(StructureController, "createSection", actorOf(role), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("keeps teachers and students out, and gives each their own section view", async () => {
    for (const role of ["TEACHER", "STUDENT"] as Role[]) {
      await expect(run(StructureController, "sections", actorOf(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const menus = (key: string) => ({ ...actorOf("TEACHER"), menus: { [key]: { access: true, insert: false, update: false, delete: false } } });
    await expect(run(OfficeController, "sections", menus("office.classes"))).resolves.toBe(true);
    await expect(run(OfficeController, "roster", actorOf("STUDENT"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(ClassroomController, "sections", { ...menus("classroom.routine"), role: "STUDENT" })).resolves.toBe(true);
  });
});

/* ------------------------------------------------------------------ input rules */

describe("structure input validation", () => {
  it("rejects a term that ends before it starts", () => {
    expect(() => termSchema.parse({ code: "2027-1", name: "Spring", startDate: "2027-06-01", endDate: "2027-01-01" })).toThrow();
    expect(termSchema.parse({ code: "2027-1", name: "Spring", startDate: "2027-01-01" }).endDate).toBeNull();
  });
  it("rejects pass marks above full marks", () => {
    expect(() => curriculumSchema.parse({ fullMarks: 50, passMarks: 60 })).toThrow();
    expect(curriculumSchema.parse({})).toEqual({ fullMarks: 100, passMarks: 33, isOptional: false, displayOrder: 100 });
  });
  it("upper-cases codes and refuses odd characters", () => {
    expect(departmentSchema.parse({ name: "General", code: "gen" }).code).toBe("GEN");
    expect(() => departmentSchema.parse({ name: "General", code: "g e n" })).toThrow();
  });
});
