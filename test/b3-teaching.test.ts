import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import type { Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { tally, weekdayOf } from "../src/modules/teaching/attendance-report.service";
import { MaterialService } from "../src/modules/teaching/material.service";
import { managedMaterialSchema, teacherMaterialSchema } from "../src/modules/teaching/material.schema";
import { TeachingController } from "../src/modules/teaching/teaching.controller";
import { OfficeService } from "../src/modules/office/office.service";
import { OfficeController } from "../src/modules/office/office.controller";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";
import { FileService } from "../src/modules/file/file.service";

type Grid = { access: boolean; insert: boolean; update: boolean; delete: boolean };
const actorOf = (role: Role, opts: { userId?: number; permissions?: Actor["permissions"]; menus?: Record<string, Partial<Grid>> } = {}): Actor => ({
  userId: opts.userId ?? 7, loginId: "x", role, name: "X", instituteId: 1, mustChangePassword: false, transport: "cookie",
  permissions: opts.permissions,
  menus: opts.menus
    ? Object.fromEntries(Object.entries(opts.menus).map(([k, g]) => [k, { access: false, insert: false, update: false, delete: false, ...g }]))
    : undefined,
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

/* ------------------------------------------------------------------ attendance tally */

describe("attendance tally", () => {
  it("counts late as attended and leaves excused absences out of the rate", () => {
    expect(tally(["PRESENT", "PRESENT", "LATE", "ABSENT", "EXCUSED"])).toEqual({
      present: 2, absent: 1, late: 1, excused: 1, total: 5, rate: 75,
    });
  });
  it("reports no rate, not 0%, when nothing countable was marked", () => {
    expect(tally([]).rate).toBeNull();
    expect(tally(["EXCUSED"]).rate).toBeNull();
  });
  it("rounds to one decimal place", () => {
    expect(tally(["PRESENT", "PRESENT", "ABSENT"]).rate).toBe(66.7);
  });
  it("reads the school weekday of a stored day", () => {
    expect(weekdayOf(new Date("2026-10-24T00:00:00Z"))).toBe("Saturday");
  });
});

/* ------------------------------------------------------------------ teacher writes stay in their own classes */

/** A class (slot 50) owned by teacher user 7; anyone else is a different teacher. */
function officePrisma() {
  return {
    classSession: {
      findFirst: vi.fn(async () => ({ id: 50, title: "Class 3 A - Bangla", sectionId: 10, subjectId: 2, semester: "2026-2", teacher: { userId: 7 } })),
    },
    teacherAssignment: { findFirst: vi.fn(async () => null) },
    sectionEnrollment: { findMany: vi.fn(async () => [{ studentUserId: 900 }, { studentUserId: 901 }]) },
    enrollment: { findMany: vi.fn(async () => []) },
    attendance: { upsert: vi.fn((args: unknown) => args) },
    assignment: {
      findUnique: vi.fn(async () => ({ id: 3, classSessionId: 50, maxMarks: 20, title: "Essay" })),
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 3, ...data })),
      update: vi.fn(async ({ data }: { data: object }) => data),
      delete: vi.fn(),
    },
    submission: {
      findUnique: vi.fn(async () => ({ id: 8, studentUserId: 900, assignment: { classSessionId: 50, maxMarks: 20, title: "Essay" } })),
      update: vi.fn(async ({ data }: { data: object }) => data),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _max: { marks: 12 } })),
    },
    notification: { createMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
}
const owner = actorOf("TEACHER", { userId: 7 });
const stranger = actorOf("TEACHER", { userId: 8 });

describe("a teacher cannot write to another teacher's class", () => {
  it("refuses attendance, assignments, edits, deletes and grading with 403", async () => {
    const prisma = officePrisma();
    const svc = new OfficeService(prisma as never);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    for (const attempt of [
      () => svc.markAttendance(stranger, 50, today, [{ studentUserId: 900, status: "PRESENT" }]),
      () => svc.postAssignment(stranger, 50, { title: "x" }),
      () => svc.updateAssignment(stranger, 3, { title: "x" }),
      () => svc.deleteAssignment(stranger, 3),
      () => svc.gradeSubmission(stranger, 8, { grade: "A" }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(prisma.attendance.upsert).not.toHaveBeenCalled();
    expect(prisma.assignment.create).not.toHaveBeenCalled();
    expect(prisma.assignment.update).not.toHaveBeenCalled();
    expect(prisma.assignment.delete).not.toHaveBeenCalled();
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });
  it("lets a teacher assigned to the section and subject grade, not only the one the slot names", async () => {
    const prisma = officePrisma();
    prisma.teacherAssignment.findFirst = vi.fn(async () => ({ id: 1 })) as never;
    await new OfficeService(prisma as never).gradeSubmission(stranger, 8, { marks: 15 });
    expect(prisma.submission.update).toHaveBeenCalled();
  });
});

describe("attendance marking", () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  it("records only the class's own students, and who marked them", async () => {
    const prisma = officePrisma();
    const res = await new OfficeService(prisma as never).markAttendance(owner, 50, today, [
      { studentUserId: 900, status: "PRESENT" },
      { studentUserId: 901, status: "EXCUSED", remark: "family event" },
      { studentUserId: 555, status: "ABSENT" }, // not in this class
      { studentUserId: 900, status: "ASLEEP" }, // not a status
    ]);
    expect(res).toEqual({ updated: 2, skipped: 2 });
    const written = (prisma.$transaction.mock.calls[0]![0] as { create: { studentUserId: number; markedById: number; remark: string | null } }[]);
    expect(written.map((w) => w.create.studentUserId)).toEqual([900, 901]);
    expect(written.every((w) => w.create.markedById === 7)).toBe(true);
    expect(written[1]!.create.remark).toBe("family event");
  });
  it("refuses a day that has not come yet", async () => {
    await expect(new OfficeService(officePrisma() as never).markAttendance(owner, 50, "2999-01-01", [{ studentUserId: 900, status: "PRESENT" }]))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
});

describe("assignments and grading", () => {
  it("keeps marks within the assignment's maximum and needs a grade or marks", async () => {
    const svc = new OfficeService(officePrisma() as never);
    await expect(svc.gradeSubmission(owner, 8, { marks: 21 })).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(svc.gradeSubmission(owner, 8, {})).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(svc.gradeSubmission(owner, 8, { marks: 20, grade: "A+" })).resolves.toMatchObject({ marks: 20, grade: "A+" });
  });
  it("will not lower the maximum below marks already given", async () => {
    await expect(new OfficeService(officePrisma() as never).updateAssignment(owner, 3, { title: "Essay", maxMarks: 10 }))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
  it("will not delete an assignment students have handed in", async () => {
    const prisma = officePrisma();
    prisma.submission.count = vi.fn(async () => 2) as never;
    await expect(new OfficeService(prisma as never).deleteAssignment(owner, 3)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.assignment.delete).not.toHaveBeenCalled();
  });
  it("tells section-placed students about a new assignment", async () => {
    const prisma = officePrisma();
    await new OfficeService(prisma as never).postAssignment(owner, 50, { title: "Essay", maxMarks: 20 });
    const sent = (prisma.notification.createMany.mock.calls[0]![0] as { data: { userId: number }[] }).data;
    expect(sent.map((n) => n.userId)).toEqual([900, 901]);
  });
});

/* ------------------------------------------------------------------ course materials */

describe("course materials", () => {
  const file = { subjectId: 2, title: "Chapter 1", kind: "FILE", fileUrl: "materials/0123456789abcdef.pdf" };
  it("accepts only a stored materials path for a file, and only https for a link", () => {
    expect(teacherMaterialSchema.parse(file).fileUrl).toBe("materials/0123456789abcdef.pdf");
    expect(() => teacherMaterialSchema.parse({ ...file, fileUrl: "assignments/0123456789abcdef.pdf" })).toThrow();
    expect(() => teacherMaterialSchema.parse({ ...file, fileUrl: "materials/../applications/x.pdf" })).toThrow();
    expect(() => teacherMaterialSchema.parse({ subjectId: 2, title: "Clip", kind: "VIDEO", linkUrl: "http://youtube.com/x" })).toThrow();
    expect(() => teacherMaterialSchema.parse({ subjectId: 2, title: "Clip", kind: "LINK" })).toThrow();
  });

  const teacherPrisma = (opts: { assigned: boolean; classTeacher?: boolean; uploadedById?: number }) => ({
    teacherProfile: { findUnique: vi.fn(async () => ({ id: 5 })) },
    section: {
      findFirst: vi.fn(async () => ({ classTeacherId: opts.classTeacher ? 5 : null })),
      findUniqueOrThrow: vi.fn(async () => ({ batch: { courseLevelId: 3 } })),
    },
    teacherAssignment: { findFirst: vi.fn(async () => (opts.assigned ? { id: 1 } : null)) },
    courseMaterial: {
      create: vi.fn(async ({ data }: { data: object }) => ({ id: 1, subject: { name: "Bangla" }, ...data })),
      findUnique: vi.fn(async () => ({ id: 1, sectionId: 10, subjectId: 2, uploadedById: opts.uploadedById ?? 7, published: true })),
      delete: vi.fn(),
    },
    sectionEnrollment: { findMany: vi.fn(async () => [{ studentUserId: 900 }]) },
    notification: { createMany: vi.fn() },
  });

  it("lets a teacher add a material only for a subject they teach in that section", async () => {
    const ok = teacherPrisma({ assigned: true });
    await new MaterialService(ok as never, { record: vi.fn() } as never).teacherCreate(owner, 10, teacherMaterialSchema.parse(file));
    expect(ok.courseMaterial.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sectionId: 10, courseLevelId: 3, uploadedById: 7 }) }));
    expect(ok.notification.createMany).toHaveBeenCalled();

    // A class teacher who does not teach the subject is still refused: materials are per subject.
    const no = teacherPrisma({ assigned: false, classTeacher: true });
    await expect(new MaterialService(no as never, { record: vi.fn() } as never).teacherCreate(owner, 10, teacherMaterialSchema.parse(file)))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(no.courseMaterial.create).not.toHaveBeenCalled();
  });
  it("lets a teacher remove only what they put up", async () => {
    const prisma = teacherPrisma({ assigned: true, uploadedById: 99 });
    await expect(new MaterialService(prisma as never, { record: vi.fn() } as never).teacherDelete(owner, 1)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.courseMaterial.delete).not.toHaveBeenCalled();
  });
  it("refuses a Head Master material whose section is in another class", async () => {
    const prisma = {
      courseLevel: { findFirst: vi.fn(async () => ({ id: 3 })) },
      subject: { findFirst: vi.fn(async () => ({ id: 2 })) },
      section: { findFirst: vi.fn(async () => ({ batch: { courseLevelId: 4 } })) },
      courseMaterial: { create: vi.fn() },
    };
    const input = managedMaterialSchema.parse({ ...file, courseLevelId: 3, sectionId: 10 });
    await expect(new MaterialService(prisma as never, { record: vi.fn() } as never).manageCreate(actorOf("HEAD_MASTER"), input))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.courseMaterial.create).not.toHaveBeenCalled();
  });
  it("shows a student their section's materials and their class-wide ones, published only", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      sectionEnrollment: { findMany: vi.fn(async () => [{ sectionId: 10, batch: { courseLevelId: 3 } }]) },
      courseMaterial: { findMany },
    };
    await new MaterialService(prisma as never, {} as never).studentList(actorOf("STUDENT"));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { published: true, OR: [{ sectionId: 10 }, { sectionId: null, courseLevelId: 3 }] },
    }));
  });
  it("gives a student with no section no materials, without querying them", async () => {
    const findMany = vi.fn();
    const prisma = { sectionEnrollment: { findMany: vi.fn(async () => []) }, courseMaterial: { findMany } };
    expect(await new MaterialService(prisma as never, {} as never).studentList(actorOf("STUDENT"))).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("materials file policy", () => {
  const files = new FileService({} as never);
  it("lets students, teachers and material managers read, and nobody else", () => {
    for (const a of [actorOf("STUDENT"), actorOf("TEACHER"), actorOf("HEAD_MASTER")]) {
      expect(() => files.authorise("materials/0123456789abcdef.pdf", a)).not.toThrow();
    }
    expect(() => files.authorise("materials/0123456789abcdef.pdf", actorOf("IT_SUPPORT"))).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() => files.authorise("materials/0123456789abcdef.pdf", null)).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});

/* ------------------------------------------------------------------ routes */

describe("B3 routes", () => {
  it("keeps the attendance monitor and material library to the Head Master", async () => {
    await expect(run(TeachingController, "overview", actorOf("HEAD_MASTER"))).resolves.toBe(true);
    await expect(run(TeachingController, "create", actorOf("HEAD_MASTER"), "POST")).resolves.toBe(true);
    for (const role of ["ADMIN_SUPPORT", "IT_SUPPORT", "TEACHER", "STUDENT"] as Role[]) {
      await expect(run(TeachingController, "create", actorOf(role), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("asks a teacher for the Update switch to delete an assignment or a material", async () => {
    const insertOnly = actorOf("TEACHER", { menus: { "office.classes": { access: true, insert: true } } });
    await expect(run(OfficeController, "deleteAssignment", insertOnly, "DELETE")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "materialDelete", insertOnly, "DELETE")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const withUpdate = actorOf("TEACHER", { menus: { "office.classes": { access: true, update: true } } });
    await expect(run(OfficeController, "deleteAssignment", withUpdate, "DELETE")).resolves.toBe(true);
  });
  it("gives students their materials and attendance summary through their existing menus", async () => {
    const student = actorOf("STUDENT", { menus: { "classroom.syllabus": { access: true }, "classroom.attendance": { access: true } } });
    await expect(run(ClassroomController, "materialList", student)).resolves.toBe(true);
    await expect(run(ClassroomController, "attendanceSummary", student)).resolves.toBe(true);
    await expect(run(ClassroomController, "materialList", actorOf("STUDENT", { menus: {} }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
