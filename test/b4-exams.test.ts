import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import type { Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { BD_GPA_5, checkBands, gradeFor, percentOf } from "../src/modules/exam/grading";
import { marksSchema, paperSchema, schemeSchema } from "../src/modules/exam/exam.schema";
import { ExamService, paperClash } from "../src/modules/exam/exam.service";
import { MarksService } from "../src/modules/exam/marks.service";
import { ExamController } from "../src/modules/exam/exam.controller";
import { OfficeController } from "../src/modules/office/office.controller";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";

type Grid = { access: boolean; insert: boolean; update: boolean; delete: boolean };
const actorOf = (role: Role, opts: { userId?: number; menus?: Record<string, Partial<Grid>> } = {}): Actor => ({
  userId: opts.userId ?? 7, loginId: "x", role, name: "X", instituteId: 1, mustChangePassword: false, transport: "cookie",
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

/* ------------------------------------------------------------------ grading */

describe("grading", () => {
  it("grades on the Bangladesh GPA 5.0 bands, lower bound inclusive", () => {
    const g = (p: number) => gradeFor(p, BD_GPA_5).grade;
    expect([g(100), g(80), g(79.99), g(70), g(60), g(50), g(40), g(33), g(32.99), g(0)])
      .toEqual(["A+", "A+", "A", "A", "A-", "B", "C", "D", "F", "F"]);
    expect(gradeFor(85, BD_GPA_5).gradePoint).toBe(5);
    expect(gradeFor(20, BD_GPA_5).passing).toBe(false);
  });
  it("works out a percentage of full marks to two places", () => {
    expect(percentOf(33, 50)).toBe(66);
    expect(percentOf(1, 3)).toBe(33.33);
  });
  it("accepts the seeded scheme and refuses broken ones", () => {
    expect(checkBands(BD_GPA_5)).toBeNull();
    expect(checkBands(BD_GPA_5.filter((b) => b.minPercent !== 0))).toMatch(/start at 0%/);
    expect(checkBands([...BD_GPA_5, { minPercent: 80, grade: "S", gradePoint: 5, passing: true }])).toMatch(/same percentage/);
    expect(checkBands([{ minPercent: 50, grade: "P", gradePoint: 1, passing: true }, { minPercent: 0, grade: "Q", gradePoint: 2, passing: true }]))
      .toMatch(/fewer points/);
    expect(checkBands([{ minPercent: 50, grade: "F", gradePoint: null, passing: false }, { minPercent: 0, grade: "P", gradePoint: null, passing: true }]))
      .toMatch(/fails but/);
  });
  it("needs grade points on every band of a GPA scheme, not of a letter scheme", () => {
    const letters = [{ minPercent: 50, grade: "Pass" }, { minPercent: 0, grade: "Fail", passing: false }];
    expect(() => schemeSchema.parse({ name: "School", kind: "GPA", bands: letters })).toThrow();
    expect(schemeSchema.parse({ name: "School", kind: "LETTER", bands: letters }).bands).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ exam schedule */

describe("exam paper clashes", () => {
  const day = new Date("2026-12-01T00:00:00Z");
  const paper = { id: 1, courseLevelId: 3, date: day, startTime: "10:00", endTime: "12:00", room: "Hall", label: "Half-yearly: Bangla" };
  it("refuses a class sitting two papers at once", () => {
    expect(paperClash({ courseLevelId: 3, date: day, startTime: "11:00", endTime: "13:00", room: null }, [paper])).toEqual({ kind: "class", label: paper.label });
  });
  it("refuses a double-booked room, ignoring case", () => {
    expect(paperClash({ courseLevelId: 4, date: day, startTime: "11:00", endTime: "13:00", room: "hall" }, [paper])).toEqual({ kind: "room", label: paper.label });
  });
  it("allows back-to-back papers, another day, and the paper itself", () => {
    expect(paperClash({ courseLevelId: 3, date: day, startTime: "12:00", endTime: "13:00", room: "Hall" }, [paper])).toBeNull();
    expect(paperClash({ courseLevelId: 3, date: new Date("2026-12-02T00:00:00Z"), startTime: "10:00", endTime: "12:00", room: "Hall" }, [paper])).toBeNull();
    expect(paperClash({ ...paper }, [paper])).toBeNull();
  });
  it("validates a paper's times and marks", () => {
    const base = { courseLevelId: 3, subjectId: 2, date: "2026-12-01", startTime: "10:00", endTime: "12:00" };
    expect(paperSchema.parse(base).fullMarks).toBeUndefined();
    expect(() => paperSchema.parse({ ...base, endTime: "09:00" })).toThrow();
    expect(() => paperSchema.parse({ ...base, fullMarks: 50, passMarks: 60 })).toThrow();
  });
  it("takes marks in halves at the finest", () => {
    expect(marksSchema.parse({ entries: [{ studentUserId: 1, obtained: 72.5 }] }).entries[0]!.obtained).toBe(72.5);
    expect(() => marksSchema.parse({ entries: [{ studentUserId: 1, obtained: 72.25 }] })).toThrow();
  });
});

/* ------------------------------------------------------------------ marks entry */

const past = new Date(Date.now() - 2 * 86_400_000);
function marksPrisma(opts: { examiner?: number | null; assigned?: boolean; sheet?: string | null; date?: Date; examStatus?: string; marks?: { studentUserId: number; obtained: number | null; isAbsent: boolean }[] } = {}) {
  return {
    examPaper: {
      findFirst: vi.fn(async () => ({
        id: 11, courseLevelId: 3, subjectId: 2, examinerId: opts.examiner ?? null, fullMarks: 100, passMarks: 33,
        date: opts.date ?? past, startTime: "10:00",
        exam: { id: 1, name: "Half-yearly", status: opts.examStatus ?? "SCHEDULED", termId: 1 }, subject: { name: "Bangla" },
      })),
    },
    section: { findFirst: vi.fn(async (args: { where: { id: number; batch?: object } }) => (args.where.batch && "courseLevelId" in args.where.batch ? { id: 10, name: "A" } : { classTeacherId: null })) },
    teacherProfile: { findUnique: vi.fn(async () => ({ id: 5 })) },
    teacherAssignment: { findFirst: vi.fn(async () => (opts.assigned === false ? null : { id: 1 })) },
    markSheet: {
      findUnique: vi.fn(async () => (opts.sheet ? { id: 99, status: opts.sheet } : null)),
      upsert: vi.fn((args: unknown) => args),
    },
    sectionEnrollment: { findMany: vi.fn(async () => [{ studentUserId: 900 }, { studentUserId: 901 }]) },
    mark: {
      upsert: vi.fn((args: unknown) => args),
      deleteMany: vi.fn((args: unknown) => args),
      findMany: vi.fn(async () => opts.marks ?? []),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
}
const audit = () => ({ record: vi.fn() });
const teacher = actorOf("TEACHER");

describe("marks entry", () => {
  it("saves a teacher's marks and absences for their own section's students", async () => {
    const prisma = marksPrisma();
    const res = await new MarksService(prisma as never, audit() as never).save(teacher, 11, 10, [
      { studentUserId: 900, obtained: 72.5, isAbsent: false },
      { studentUserId: 901, obtained: null, isAbsent: true },
    ]);
    expect(res).toEqual({ saved: 2, cleared: 0 });
    expect(prisma.mark.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ paperId: 11, sectionId: 10, studentUserId: 900, obtained: 72.5, enteredById: 7 }),
    }));
  });
  it("refuses a teacher who does not teach the subject in that section with 403", async () => {
    const prisma = marksPrisma({ assigned: false });
    await expect(new MarksService(prisma as never, audit() as never).save(teacher, 11, 10, [{ studentUserId: 900, obtained: 50, isAbsent: false }]))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("lets the paper's examiner mark any section of the class", async () => {
    const prisma = marksPrisma({ assigned: false, examiner: 5 });
    await expect(new MarksService(prisma as never, audit() as never).save(teacher, 11, 10, [{ studentUserId: 900, obtained: 50, isAbsent: false }]))
      .resolves.toEqual({ saved: 1, cleared: 0 });
  });
  it("refuses marks above full marks and students from outside the section", async () => {
    const svc = new MarksService(marksPrisma() as never, audit() as never);
    await expect(svc.save(teacher, 11, 10, [{ studentUserId: 900, obtained: 101, isAbsent: false }])).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(svc.save(teacher, 11, 10, [{ studentUserId: 555, obtained: 50, isAbsent: false }])).rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
  it("refuses marks before the paper is sat, or for an exam not scheduled", async () => {
    const future = new Date(Date.now() + 5 * 86_400_000);
    await expect(new MarksService(marksPrisma({ date: future }) as never, audit() as never).save(teacher, 11, 10, []))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
    await expect(new MarksService(marksPrisma({ examStatus: "DRAFT" }) as never, audit() as never).save(teacher, 11, 10, []))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });
  it("keeps submitted and locked marks closed to teachers", async () => {
    for (const sheet of ["SUBMITTED", "LOCKED"]) {
      const prisma = marksPrisma({ sheet });
      await expect(new MarksService(prisma as never, audit() as never).save(teacher, 11, 10, [{ studentUserId: 900, obtained: 50, isAbsent: false }]))
        .rejects.toMatchObject({ code: "CONFLICT" });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    }
  });
  it("submits only a complete sheet, and records who submitted it", async () => {
    const partial = marksPrisma({ marks: [{ studentUserId: 900, obtained: 50, isAbsent: false }] });
    await expect(new MarksService(partial as never, audit() as never).submit(teacher, 11, 10)).rejects.toMatchObject({ code: "UNPROCESSABLE", details: { missing: 1 } });

    const complete = marksPrisma({ marks: [{ studentUserId: 900, obtained: 50, isAbsent: false }, { studentUserId: 901, obtained: null, isAbsent: true }] });
    const a = audit();
    await expect(new MarksService(complete as never, a as never).submit(teacher, 11, 10)).resolves.toMatchObject({ status: "SUBMITTED" });
    expect(complete.markSheet.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: "SUBMITTED", submittedById: 7 }) }));
    expect(a.record).toHaveBeenCalledWith(7, "MARKS_SUBMIT", "MarkSheet", "11/10", expect.any(String));
  });
});

/* ------------------------------------------------------------------ Head Master reopen */

describe("reopening submitted marks", () => {
  const prismaFor = (status: string | null) => ({
    examPaper: { findFirst: vi.fn(async () => ({ id: 11, examId: 1, exam: { status: "SCHEDULED" } })) },
    markSheet: { findUnique: vi.fn(async () => (status ? { id: 99, status } : null)), update: vi.fn() },
  });
  it("sends a submitted sheet back to draft, with the reason in the audit log", async () => {
    const prisma = prismaFor("SUBMITTED");
    const a = audit();
    await expect(new ExamService(prisma as never, a as never, {} as never).reopen(actorOf("HEAD_MASTER"), 11, 10, "Roll 4's paper was mis-added."))
      .resolves.toMatchObject({ status: "DRAFT" });
    expect(prisma.markSheet.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT", reopenedById: 7, reopenReason: "Roll 4's paper was mis-added." }),
    }));
    expect(a.record).toHaveBeenCalledWith(7, "MARKS_REOPEN", "MarkSheet", 99, "Roll 4's paper was mis-added.", expect.objectContaining({
      diff: { before: { status: "SUBMITTED" }, after: { status: "DRAFT", reason: "Roll 4's paper was mis-added." } },
    }));
  });
  it("will not reopen a draft or locked sheet", async () => {
    for (const status of ["DRAFT", "LOCKED"]) {
      const prisma = prismaFor(status);
      await expect(new ExamService(prisma as never, audit() as never, {} as never).reopen(actorOf("HEAD_MASTER"), 11, 10, "a good reason"))
        .rejects.toMatchObject({ code: "CONFLICT" });
      expect(prisma.markSheet.update).not.toHaveBeenCalled();
    }
  });
  it("fixes a paper's full and pass marks once any section has submitted", async () => {
    const prisma = {
      examPaper: { findFirst: vi.fn(async () => ({ id: 11, examId: 1, courseLevelId: 3, fullMarks: 100, passMarks: 33, exam: { status: "SCHEDULED" } })), update: vi.fn() },
      markSheet: { count: vi.fn(async () => 1) },
    };
    const input = { date: new Date("2026-12-01T00:00:00Z"), startTime: "10:00", endTime: "12:00", room: null, fullMarks: 50, passMarks: 17, examinerId: null };
    await expect(new ExamService(prisma as never, audit() as never, {} as never).updatePaper(actorOf("HEAD_MASTER"), 11, input))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.examPaper.update).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ routes */

describe("B4 routes", () => {
  it("keeps exams and grading to the Head Master", async () => {
    await expect(run(ExamController, "create", actorOf("HEAD_MASTER"), "POST")).resolves.toBe(true);
    await expect(run(ExamController, "reopen", actorOf("HEAD_MASTER"), "POST")).resolves.toBe(true);
    for (const role of ["ADMIN_SUPPORT", "IT_SUPPORT", "TEACHER", "STUDENT"] as Role[]) {
      await expect(run(ExamController, "create", actorOf(role), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("gives the Head Master no marks-entry route", () => {
    const proto = ExamController.prototype as unknown as Record<string, unknown>;
    expect(Object.getOwnPropertyNames(proto).filter((n) => /save|submit/i.test(n))).toEqual([]);
  });
  it("asks a teacher for the Insert switch to enter and submit marks", async () => {
    const readOnly = actorOf("TEACHER", { menus: { "office.classes": { access: true } } });
    await expect(run(OfficeController, "saveMarks", readOnly, "PUT")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(OfficeController, "submitMarks", readOnly, "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const canInsert = actorOf("TEACHER", { menus: { "office.classes": { access: true, insert: true } } });
    await expect(run(OfficeController, "saveMarks", canInsert, "PUT")).resolves.toBe(true);
  });
  it("shows students the exam schedule through their routine menu", async () => {
    await expect(run(ClassroomController, "exams", actorOf("STUDENT", { menus: { "classroom.routine": { access: true } } }))).resolves.toBe(true);
    await expect(run(ClassroomController, "exams", actorOf("TEACHER"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
