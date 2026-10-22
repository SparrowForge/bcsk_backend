import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import type { Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { computeResults, type PaperIn, type StudentIn } from "../src/modules/result/compute";
import { BD_GPA_5 } from "../src/modules/exam/grading";
import { ResultService } from "../src/modules/result/result.service";
import { assertPrintable, renderTemplate, unknownPlaceholders } from "../src/modules/result/templates";
import { templateSchema } from "../src/modules/result/result.schema";
import { certificatesPdf, markSheetPdf, tabulationPdf } from "../src/modules/result/result-pdf";
import { ResultController } from "../src/modules/result/result.controller";
import { ClassroomController } from "../src/modules/classroom/classroom.controller";
import { OfficeController } from "../src/modules/office/office.controller";

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

/* ------------------------------------------------------------------ result computation */

const papers: PaperIn[] = [
  { paperId: 1, subjectName: "Bangla", fullMarks: 100, passMarks: 33, isOptional: false },
  { paperId: 2, subjectName: "English", fullMarks: 100, passMarks: 33, isOptional: false },
  { paperId: 3, subjectName: "Arabic", fullMarks: 100, passMarks: 33, isOptional: true },
];
const student = (id: number, sectionId: number, roll: number, marks: Array<number | "abs" | null>): StudentIn => ({
  studentUserId: id, sectionId, rollNo: roll,
  marks: marks.map((m, i) => ({ paperId: i + 1, obtained: m === "abs" || m === null ? null : m, isAbsent: m === "abs" })).filter((_, i) => marks[i] !== null),
});
const gpa = { kind: "GPA", bands: BD_GPA_5 };

describe("result computation (GPA)", () => {
  it("averages compulsory grade points and adds only what an optional subject earns above 2.0", () => {
    // Bangla 85 (A+ 5), English 72 (A 4) -> 4.5; Arabic 80 (A+ 5) adds (5 - 2) / 2 = 1.5 -> capped at 5.
    const [r] = computeResults(papers, [student(1, 10, 1, [85, 72, 80])], gpa, "SHARED");
    expect(r!.gpa).toBe(5);
    expect(r!.grade).toBe("A+");
    const [r2] = computeResults(papers, [student(1, 10, 1, [85, 72, 55])], gpa, "SHARED"); // Arabic B 3 -> +0.5
    expect(r2!.gpa).toBe(5);
    const [r3] = computeResults(papers, [student(1, 10, 1, [65, 62, 40])], gpa, "SHARED"); // 3.5 + (2-2)/2 = 3.5
    expect(r3).toMatchObject({ gpa: 3.5, grade: "A-", passed: true, totalObtained: 167, totalFull: 300 });
  });
  it("fails the whole result on one failed compulsory subject: GPA 0, grade F", () => {
    const [r] = computeResults(papers, [student(1, 10, 1, [90, 20, 90])], gpa, "SHARED");
    expect(r).toMatchObject({ gpa: 0, grade: "F", passed: false, failedSubjects: 1 });
    expect(r!.lines[1]).toMatchObject({ subjectName: "English", grade: "F", gradePoint: 0, passed: false });
  });
  it("does not fail the result on a failed optional subject", () => {
    const [r] = computeResults(papers, [student(1, 10, 1, [70, 70, 10])], gpa, "SHARED");
    expect(r).toMatchObject({ passed: true, gpa: 4 });
  });
  it("treats an absence, or a mark never entered, as a failed subject scoring 0", () => {
    const [r] = computeResults(papers, [student(1, 10, 1, ["abs", 80, 80])], gpa, "SHARED");
    expect(r!.lines[0]).toMatchObject({ isAbsent: true, obtained: null, grade: "F", passed: false });
    const [r2] = computeResults(papers, [student(1, 10, 1, [null, 80, 80])], gpa, "SHARED");
    expect(r2!.lines[0]).toMatchObject({ isAbsent: true, passed: false });
  });
  it("fails a subject below its own pass mark even when the band would pass", () => {
    const strict = papers.map((p) => (p.paperId === 1 ? { ...p, passMarks: 40 } : p));
    const [r] = computeResults(strict, [student(1, 10, 1, [35, 80, 80])], gpa, "SHARED"); // 35% is D, but pass mark is 40
    expect(r!.lines[0]).toMatchObject({ grade: "F", passed: false });
    expect(r!.passed).toBe(false);
  });
});

describe("result computation (letter scheme)", () => {
  const letters = { kind: "LETTER", bands: [
    { minPercent: 75, grade: "Excellent", gradePoint: null, passing: true },
    { minPercent: 40, grade: "Pass", gradePoint: null, passing: true },
    { minPercent: 0, grade: "Fail", gradePoint: null, passing: false },
  ] };
  it("grades the overall percentage and gives no GPA", () => {
    const [r] = computeResults(papers.slice(0, 2), [student(1, 10, 1, [80, 72])], letters, "SHARED");
    expect(r).toMatchObject({ gpa: null, percent: 76, grade: "Excellent", passed: true });
  });
});

describe("places", () => {
  const two = papers.slice(0, 2);
  const cohort = [
    student(1, 10, 1, [80, 80]), // GPA 5, 160
    student(2, 10, 2, [80, 80]), // GPA 5, 160 - tied with 1
    student(3, 10, 3, [70, 70]), // GPA 4
    student(4, 11, 1, [90, 90]), // GPA 5, 180 - other section, top of class
    student(5, 11, 2, [99, 10]), // failed, high total
  ];
  it("shares a place on a full tie and skips the next (SHARED)", () => {
    const r = computeResults(two, cohort, gpa, "SHARED");
    const place = (id: number) => r.find((x) => x.studentUserId === id)!;
    expect([1, 2, 3].map((id) => place(id).sectionPosition)).toEqual([1, 1, 3]);
    expect([4, 1, 2, 3, 5].map((id) => place(id).classPosition)).toEqual([1, 2, 2, 4, 5]);
  });
  it("breaks ties by roll number (SPLIT)", () => {
    const r = computeResults(two, cohort, gpa, "SPLIT");
    expect([1, 2, 3].map((id) => r.find((x) => x.studentUserId === id)!.sectionPosition)).toEqual([1, 2, 3]);
  });
  it("ranks every passed student above a failed one, whatever the total", () => {
    const r = computeResults(two, cohort, gpa, "SHARED");
    expect(r.find((x) => x.studentUserId === 5)).toMatchObject({ passed: false, sectionPosition: 2, classPosition: 5 });
  });
});

/* ------------------------------------------------------------------ workflow */

function workflowPrisma(opts: { status?: string | null; sheets?: string[]; settled?: number } = {}) {
  const tx = vi.fn(async (ops: unknown[]) => ops);
  return {
    exam: {
      findFirst: vi.fn(async () => ({
        id: 1, name: "Half-yearly", status: "SCHEDULED", termId: 1, term: { code: "2026-2", name: "Semester 2026-2" },
        gradingScheme: { kind: "GPA", bands: BD_GPA_5 },
      })),
    },
    examPaper: {
      findMany: vi.fn(async () => [
        { id: 1, subjectId: 1, fullMarks: 100, passMarks: 33, subject: { name: "Bangla" }, sheets: (opts.sheets ?? ["SUBMITTED"]).map((status) => ({ sectionId: 10, status })) },
      ]),
    },
    section: { findMany: vi.fn(async () => [{ id: 10, name: "A" }]) },
    sectionResult: {
      count: vi.fn(async () => opts.settled ?? 0),
      findUnique: vi.fn(async () => (opts.status ? { id: 5, status: opts.status, sectionId: 10 } : null)),
      update: vi.fn((a: unknown) => a), upsert: vi.fn((a: unknown) => a),
    },
    sectionEnrollment: { findMany: vi.fn(async () => [{ studentUserId: 900, sectionId: 10, rollNo: 1 }]) },
    mark: { findMany: vi.fn(async () => [{ paperId: 1, studentUserId: 900, obtained: 81, isAbsent: false }]) },
    curriculumSubject: { findMany: vi.fn(async () => []) },
    institute: { findUniqueOrThrow: vi.fn(async () => ({ rankTies: "SHARED" })) },
    resultSummary: {
      deleteMany: vi.fn((a: unknown) => a), create: vi.fn((a: unknown) => a),
      findMany: vi.fn(async () => [{ studentUserId: 900, sectionId: 10, gpa: 5, grade: "A+", lines: [{ subjectName: "Bangla", fullMarks: 100, obtained: 81, grade: "A+", isAbsent: false }] }]),
      findUnique: vi.fn(async () => ({ sectionId: 10 })),
    },
    markSheet: { updateMany: vi.fn((a: unknown) => a) },
    examResult: { upsert: vi.fn((a: unknown) => a), deleteMany: vi.fn((a: unknown) => a) },
    notification: { createMany: vi.fn((a: unknown) => a) },
    $transaction: tx,
  };
}
const hm = actorOf("HEAD_MASTER");
const audit = () => ({ record: vi.fn() });

describe("results workflow", () => {
  it("processes a class once every section's marks are in", async () => {
    const prisma = workflowPrisma();
    const res = await new ResultService(prisma as never, audit() as never).process(hm, 1, 3);
    expect(res).toEqual({ examId: 1, courseLevelId: 3, students: 1, sections: 1, passed: 1 });
    expect(prisma.resultSummary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ studentUserId: 900, gpa: 5, grade: "A+", sectionPosition: 1, classPosition: 1 }),
    }));
  });
  it("refuses to process while a mark sheet is still a draft", async () => {
    const prisma = workflowPrisma({ sheets: ["DRAFT"] });
    await expect(new ResultService(prisma as never, audit() as never).process(hm, 1, 3)).rejects.toMatchObject({ code: "UNPROCESSABLE" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("refuses to re-process once a section is approved, since places would change", async () => {
    await expect(new ResultService(workflowPrisma({ settled: 1 }) as never, audit() as never).process(hm, 1, 3)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("approving locks the section's mark sheets for good", async () => {
    const prisma = workflowPrisma({ status: "PROCESSED" });
    await new ResultService(prisma as never, audit() as never).approve(hm, 1, 10);
    expect(prisma.markSheet.updateMany).toHaveBeenCalledWith({ where: { sectionId: 10, paper: { examId: 1 } }, data: { status: "LOCKED" } });
  });
  it("returning reopens the mark sheets with the reason and clears the results", async () => {
    const prisma = workflowPrisma({ status: "PROCESSED" });
    await new ResultService(prisma as never, audit() as never).returnToTeachers(hm, 1, 10, "Recheck roll 3's English.");
    expect(prisma.markSheet.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DRAFT", reopenReason: "Recheck roll 3's English." }) }));
    expect(prisma.resultSummary.deleteMany).toHaveBeenCalledWith({ where: { examId: 1, sectionId: 10 } });
  });
  it("publishes only approved results, into the older results table, and tells the students", async () => {
    await expect(new ResultService(workflowPrisma({ status: "PROCESSED" }) as never, audit() as never).publish(hm, 1, 10)).rejects.toMatchObject({ code: "CONFLICT" });
    const prisma = workflowPrisma({ status: "APPROVED" });
    await new ResultService(prisma as never, audit() as never).publish(hm, 1, 10);
    expect(prisma.examResult.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { studentUserId: 900, semester: "2026-2", subject: "Half-yearly: Bangla", fullMarks: 100, marks: 81, grade: "A+", remark: null, examId: 1 },
    }));
    expect(prisma.notification.createMany).toHaveBeenCalled();
  });
  it("withdraws a publication, removing exactly the rows it wrote", async () => {
    const prisma = workflowPrisma({ status: "PUBLISHED" });
    await new ResultService(prisma as never, audit() as never).withdraw(hm, 1, 10, "Wrong paper totals.");
    expect(prisma.examResult.deleteMany).toHaveBeenCalledWith({ where: { examId: 1, studentUserId: { in: [900] } } });
  });
  it("hides unpublished results from the student, and every student's results from the others", async () => {
    const unpublished = workflowPrisma({ status: "APPROVED" });
    await expect(new ResultService(unpublished as never, audit() as never).studentResult(actorOf("STUDENT", { userId: 900 }), 1, 900))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const published = workflowPrisma({ status: "PUBLISHED" });
    await expect(new ResultService(published as never, audit() as never).studentResult(actorOf("STUDENT", { userId: 901 }), 1, 900))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* ------------------------------------------------------------------ templates and PDFs */

describe("document templates", () => {
  it("fills placeholders and leaves an unknown one visible", () => {
    expect(renderTemplate("{{name}} of {{ class }} - {{nickname}}", { name: "Arif Rahman", class: "Class 2" })).toBe("Arif Rahman of Class 2 - {{nickname}}");
    expect(unknownPlaceholders("{{name}} {{nickname}}")).toEqual(["nickname"]);
    expect(() => templateSchema.parse({ title: "Certificate", body: "Dear {{nickname}}, well done." })).toThrow();
  });
  it("prints Bengali now its font ships (B7), and still refuses a script no font covers", () => {
    expect(() => assertPrintable("bn", "আরিফ")).not.toThrow();
    expect(() => assertPrintable("en", "Arif Rahman · Class 2 – A")).not.toThrow();
    expect(() => assertPrintable("en", "العربية")).toThrow(expect.objectContaining({ code: "UNPROCESSABLE" }));
  });
  it("draws real PDFs", async () => {
    const head = { name: "BCSK" };
    const summary = {
      rollNo: 1, name: "Arif Rahman", studentId: "BCSK-2026-0001", totalObtained: 153, totalFull: 200, percent: 76.5, gpa: 4.5, grade: "A",
      passed: true, sectionPosition: 1, classPosition: 2,
      lines: [{ subjectName: "Bangla", fullMarks: 100, passMarks: 33, obtained: 81, isAbsent: false, grade: "A+", gradePoint: 5, passed: true }],
    };
    const h = { head, exam: "Half-yearly", term: "2026-2", className: "Class 2", section: "A" };
    for (const pdf of [
      await tabulationPdf(h, ["Bangla"], [summary]),
      await markSheetPdf(h, "BCSK-MS-1-ABCDEFGHJK", summary, { name: "Bangladesh GPA 5.0", kind: "GPA" }),
      await certificatesPdf(head, [{ title: "Certificate", body: "Text", signatoryName: null, signatoryTitle: "Head Master", serial: "BCSK-COMP-2026-ABCDEFGHJK" }]),
    ]) {
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    }
  });
});

/* ------------------------------------------------------------------ routes */

describe("B5 routes", () => {
  it("keeps processing, approving and publishing to the Head Master", async () => {
    for (const h of ["process", "approve", "returnResults", "publish", "withdraw"]) {
      await expect(run(ResultController, h, hm, "POST")).resolves.toBe(true);
      for (const role of ["ADMIN_SUPPORT", "IT_SUPPORT"] as Role[]) {
        await expect(run(ResultController, h, actorOf(role), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });
  it("lets office staff print certificates, as they already print student documents, but not IT", async () => {
    await expect(run(ResultController, "issue", hm, "POST")).resolves.toBe(true);
    await expect(run(ResultController, "issue", actorOf("ADMIN_SUPPORT"), "POST")).resolves.toBe(true);
    await expect(run(ResultController, "issue", actorOf("IT_SUPPORT"), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("lets students reach only their own results and documents, through their menus", async () => {
    const student = actorOf("STUDENT", { menus: { "classroom.results": { access: true }, "classroom.documents": { access: true } } });
    for (const h of ["examResults", "markSheet", "certificates", "certificate"]) await expect(run(ClassroomController, h, student)).resolves.toBe(true);
    await expect(run(ClassroomController, "markSheet", actorOf("STUDENT", { menus: {} }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(ResultController, "sectionReport", student)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("gives teachers a read-only view of their sections' results", async () => {
    const teacher = actorOf("TEACHER", { menus: { "office.classes": { access: true } } });
    await expect(run(OfficeController, "sectionResults", teacher)).resolves.toBe(true);
    await expect(run(ResultController, "approve", teacher, "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
