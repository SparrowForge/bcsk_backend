import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "../src/common/guards/auth.guard";
import type { Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { BD_GPA_5 } from "../src/modules/exam/grading";
import { ResultService } from "../src/modules/result/result.service";
import { ReportService, csvCell } from "../src/modules/result/report.service";
import { DocumentService } from "../src/modules/document/document.service";
import { ResultController } from "../src/modules/result/result.controller";
import { OfficeController } from "../src/modules/office/office.controller";

/*
 * Completing results and certificates: withholding one student's result, a CSV tabulation, a
 * student's results across exams for their teachers, and certificate provenance and revocation.
 */

type Grid = { access: boolean; insert: boolean; update: boolean; delete: boolean };
const actorOf = (role: Role, opts: { userId?: number; instituteId?: number; menus?: Record<string, Partial<Grid>> } = {}): Actor => ({
  userId: opts.userId ?? 7, loginId: "x", role, name: "X", instituteId: opts.instituteId ?? 1, mustChangePassword: false, transport: "cookie",
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

const hm = actorOf("HEAD_MASTER");
const audit = () => ({ record: vi.fn() });
const line = (obtained: number | null) => ({ subjectName: "Bangla", fullMarks: 100, obtained, grade: obtained == null ? "F" : "A+", isAbsent: obtained == null });

/* ------------------------------------------------------------------ withholding */

type Summary = { id: number; studentUserId: number; sectionId: number; gpa: number | null; grade: string; withheld: boolean; withheldReason: string | null; lines: ReturnType<typeof line>[] };

function resultsPrisma(opts: { status?: string; summaries?: Summary[]; held?: { studentUserId: number; withheldReason: string }[] } = {}) {
  const summaries: Summary[] = opts.summaries ?? [
    { id: 1, studentUserId: 900, sectionId: 10, gpa: 5, grade: "A+", withheld: false, withheldReason: null, lines: [line(81)] },
    { id: 2, studentUserId: 901, sectionId: 10, gpa: 4, grade: "A", withheld: true, withheldReason: "Unpaid dues", lines: [line(72)] },
  ];
  return {
    exam: {
      findFirst: vi.fn(async () => ({
        id: 1, name: "Half-yearly", status: "SCHEDULED", termId: 1, term: { code: "2026-2", name: "Semester 2026-2" },
        gradingScheme: { kind: "GPA", bands: BD_GPA_5 },
      })),
    },
    examPaper: {
      findMany: vi.fn(async () => [{ id: 1, subjectId: 1, fullMarks: 100, passMarks: 33, subject: { name: "Bangla" }, sheets: [{ sectionId: 10, status: "SUBMITTED" }] }]),
    },
    section: { findMany: vi.fn(async () => [{ id: 10, name: "A" }]) },
    sectionResult: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => (opts.status ? { id: 5, status: opts.status, sectionId: 10 } : null)),
      update: vi.fn((a: unknown) => a), upsert: vi.fn((a: unknown) => a),
    },
    sectionEnrollment: { findMany: vi.fn(async () => [{ studentUserId: 900, sectionId: 10, rollNo: 1 }]) },
    mark: { findMany: vi.fn(async () => [{ paperId: 1, studentUserId: 900, obtained: 81, isAbsent: false }]) },
    curriculumSubject: { findMany: vi.fn(async () => []) },
    institute: { findUniqueOrThrow: vi.fn(async () => ({ rankTies: "SHARED" })) },
    resultSummary: {
      deleteMany: vi.fn((a: unknown) => a), create: vi.fn((a: unknown) => a), update: vi.fn((a: unknown) => a),
      findMany: vi.fn(async (args: { where: { withheld?: boolean } }) =>
        args.where.withheld ? (opts.held ?? []).map((h) => ({ ...h, withheld: true, withheldAt: new Date(0), withheldById: 7 })) : summaries),
      findUnique: vi.fn(async (args: { where: { examId_studentUserId: { studentUserId: number } } }) =>
        summaries.find((s) => s.studentUserId === args.where.examId_studentUserId.studentUserId) ?? null),
    },
    markSheet: { updateMany: vi.fn((a: unknown) => a) },
    examResult: { upsert: vi.fn((a: unknown) => a), deleteMany: vi.fn((a: unknown) => a) },
    notification: { createMany: vi.fn((a: unknown) => a) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  };
}

describe("withholding one student's result", () => {
  it("publishes the section without the withheld student: no result rows, no notification", async () => {
    const prisma = resultsPrisma({ status: "APPROVED" });
    const res = await new ResultService(prisma as never, audit() as never).publish(hm, 1, 10);
    expect(res).toMatchObject({ status: "PUBLISHED", students: 1, withheld: 1 });
    const written = prisma.examResult.upsert.mock.calls.map(([a]) => (a as { create: { studentUserId: number } }).create.studentUserId);
    expect(written).toEqual([900]);
    const told = (prisma.notification.createMany.mock.calls[0]![0] as { data: { userId: number }[] }).data.map((n) => n.userId);
    expect(told).toEqual([900]);
  });

  it("keeps a withheld result withheld when the class is processed again", async () => {
    const prisma = resultsPrisma({ held: [{ studentUserId: 900, withheldReason: "Disciplinary case" }] });
    await new ResultService(prisma as never, audit() as never).process(hm, 1, 3);
    expect(prisma.resultSummary.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ studentUserId: 900, withheld: true, withheldReason: "Disciplinary case" }),
    }));
  });

  it("takes an already published result down for that student only", async () => {
    const prisma = resultsPrisma({ status: "PUBLISHED" });
    await new ResultService(prisma as never, audit() as never).withhold(hm, 1, 900, "Unpaid tuition for June.");
    expect(prisma.resultSummary.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ withheld: true, withheldReason: "Unpaid tuition for June." }) }));
    expect(prisma.examResult.deleteMany).toHaveBeenCalledWith({ where: { examId: 1, studentUserId: 900 } });
  });

  it("before publication only marks the result; nothing is shown or removed", async () => {
    const prisma = resultsPrisma({ status: "APPROVED" });
    await new ResultService(prisma as never, audit() as never).withhold(hm, 1, 900, "Unpaid tuition for June.");
    expect(prisma.examResult.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses twice, and refuses a returned section", async () => {
    await expect(new ResultService(resultsPrisma({ status: "PUBLISHED" }) as never, audit() as never).withhold(hm, 1, 901, "Again, for dues."))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(new ResultService(resultsPrisma({ status: "RETURNED" }) as never, audit() as never).withhold(hm, 1, 900, "For dues, again."))
      .rejects.toMatchObject({ code: "UNPROCESSABLE" });
  });

  it("releasing into a published section shows the result and tells the student", async () => {
    const prisma = resultsPrisma({ status: "PUBLISHED" });
    await new ResultService(prisma as never, audit() as never).release(hm, 1, 901);
    expect(prisma.resultSummary.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, data: expect.objectContaining({ withheld: false, withheldReason: null }) }));
    expect(prisma.examResult.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ studentUserId: 901, marks: 72 }) }));
    expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: 901 })] });
  });

  it("tells the student their result is withheld, and keeps it out of their list", async () => {
    const prisma = resultsPrisma({ status: "PUBLISHED" });
    await expect(new ResultService(prisma as never, audit() as never).studentResult(actorOf("STUDENT", { userId: 901 }), 1, 901))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const list = {
      sectionResult: { findMany: vi.fn(async () => [{ examId: 1, sectionId: 10 }]) },
      resultSummary: { findMany: vi.fn(async () => []) },
    };
    await new ResultService(list as never, audit() as never).publishedForStudent(actorOf("STUDENT", { userId: 901 }));
    const args = list.resultSummary.findMany.mock.calls[0]![0] as { where: { withheld: boolean }; select: Record<string, unknown> };
    expect(args.where.withheld).toBe(false);
    expect(args.select).not.toHaveProperty("withheldReason");
  });
});

/* ------------------------------------------------------------------ a student's results, for teachers */

describe("a student's results across exams", () => {
  const teacher = actorOf("TEACHER", { userId: 50 });
  const perfPrisma = (teaches: boolean) => ({
    user: { findFirst: vi.fn(async () => ({ id: 900, name: "Rahim", studentProfile: { studentId: "S-900" } })) },
    sectionEnrollment: { findMany: vi.fn(async () => [{ sectionId: 10 }]) },
    teacherProfile: { findUnique: vi.fn(async () => ({ id: 3 })) },
    section: { findFirst: vi.fn(async () => ({ classTeacherId: teaches ? 3 : 99 })) },
    teacherAssignment: { findFirst: vi.fn(async () => null) },
    sectionResult: { findMany: vi.fn(async () => [{ examId: 1, sectionId: 10, status: "APPROVED" }]) },
    resultSummary: { findMany: vi.fn(async () => [{ id: 1, sectionId: 10, withheld: false, exam: { id: 1, name: "Half-yearly" }, lines: [] }]) },
  });
  it("is open to the student's own teachers, with each result's state", async () => {
    const res = await new ResultService(perfPrisma(true) as never, audit() as never).studentPerformance(teacher, 900);
    expect(res.student).toEqual({ id: 900, name: "Rahim", studentId: "S-900" });
    expect(res.results[0]).toMatchObject({ status: "APPROVED" });
  });
  it("is refused to a teacher who doesn't teach the student", async () => {
    await expect(new ResultService(perfPrisma(false) as never, audit() as never).studentPerformance(teacher, 900)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("finds no student of another institute", async () => {
    const prisma = { ...perfPrisma(true), user: { findFirst: vi.fn(async () => null) } };
    await expect(new ResultService(prisma as never, audit() as never).studentPerformance(hm, 900)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* ------------------------------------------------------------------ CSV tabulation */

describe("tabulation CSV", () => {
  it("neutralises spreadsheet formulas but leaves negative numbers alone", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvCell("-5")).toBe(`"-5"`);
    expect(csvCell(null)).toBe(`""`);
  });
  it("has one row per student and a marks and grade column per subject, totals as processed", async () => {
    const results = {
      sectionReport: vi.fn(async () => ({
        exam: { name: "Half-yearly", term: { code: "2026-2" }, gradingScheme: { kind: "GPA" } },
        status: "APPROVED", section: "A", className: "Class 3", subjects: ["Bangla", "English"],
        summaries: [
          { rollNo: 1, student: { name: "Rahim", studentProfile: { studentId: "S-1" } }, totalObtained: 150, totalFull: 200, percent: 75, gpa: 4, grade: "A", passed: true, failedSubjects: 0, sectionPosition: 1, classPosition: 2, withheld: false,
            lines: [{ subjectName: "Bangla", obtained: 80, grade: "A+", isAbsent: false }, { subjectName: "English", obtained: 70, grade: "A", isAbsent: false }] },
          { rollNo: 2, student: { name: "=cmd", studentProfile: null }, totalObtained: 40, totalFull: 200, percent: 20, gpa: 0, grade: "F", passed: false, failedSubjects: 2, sectionPosition: null, classPosition: null, withheld: true,
            lines: [{ subjectName: "Bangla", obtained: 40, grade: "C", isAbsent: false }, { subjectName: "English", obtained: null, grade: "F", isAbsent: true }] },
        ],
      })),
    };
    const { filename, csv } = await new ReportService({} as never, audit() as never, results as never).tabulationCsv(hm, 1, 10);
    expect(filename).toBe("tabulation-1-10.csv");
    expect(csv.startsWith("﻿")).toBe(true);
    const rows = csv.slice(1).split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain(`"Bangla (marks)","Bangla (grade)","English (marks)","English (grade)","total","full_marks","percent","gpa"`);
    expect(rows[1]).toBe(`"1","S-1","Rahim","80","A+","70","A","150","200","75.00","4.00","A","PASS","0","1","2",""`);
    expect(rows[2]).toContain(`"'=cmd"`);
    expect(rows[2]).toContain(`"ABS","F"`);
    expect(rows[2]?.endsWith(`"yes"`)).toBe(true);
  });
});

/* ------------------------------------------------------------------ certificates */

describe("certificate revocation", () => {
  const cert = (over: Record<string, unknown> = {}) => ({
    id: 4, serial: "BCSK-COMP-2026-ABC123", type: "COMPLETION", studentUserId: 900, revokedAt: null, issuedAt: new Date("2026-10-01"),
    dataJson: JSON.stringify({ title: "Certificate", body: "Body", signatoryName: null, signatoryTitle: null }),
    student: { instituteId: 1, name: "Rahim", studentProfile: { studentId: "S-900" } }, ...over,
  });
  const certPrisma = (c: ReturnType<typeof cert> | null) => ({
    certificate: { findUnique: vi.fn(async () => c), update: vi.fn(async (a: unknown) => a), findFirst: vi.fn(async () => null) },
    payment: { findUnique: vi.fn(async () => null) },
  });

  it("revokes with a reason, audited", async () => {
    const prisma = certPrisma(cert());
    const a = audit();
    const res = await new ReportService(prisma as never, a as never, {} as never).revoke(hm, "BCSK-COMP-2026-ABC123", "Issued with the wrong name.");
    expect(res.serial).toBe("BCSK-COMP-2026-ABC123");
    expect(prisma.certificate.update).toHaveBeenCalledWith({ where: { id: 4 }, data: expect.objectContaining({ revokedById: 7, revokeReason: "Issued with the wrong name." }) });
    expect(a.record).toHaveBeenCalledWith(7, "CERTIFICATE_REVOKE", "Certificate", "BCSK-COMP-2026-ABC123", expect.any(String), expect.anything());
  });
  it("refuses a second revocation, and another institute's document", async () => {
    await expect(new ReportService(certPrisma(cert({ revokedAt: new Date() })) as never, audit() as never, {} as never).revoke(hm, "X-123456", "Wrong name on it."))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(new ReportService(certPrisma(cert({ student: { instituteId: 2 } })) as never, audit() as never, {} as never).revoke(hm, "X-123456", "Wrong name on it."))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("never reprints a revoked document", async () => {
    await expect(new ReportService(certPrisma(cert({ revokedAt: new Date() })) as never, audit() as never, {} as never).reprint(actorOf("STUDENT", { userId: 900 }), "BCSK-COMP-2026-ABC123"))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("verifies publicly as revoked, without naming the student", async () => {
    const revokedAt = new Date("2026-10-20");
    const res = await new DocumentService(certPrisma(cert({ revokedAt })) as never).verify("BCSK-COMP-2026-ABC123");
    expect(res).toEqual({ valid: false, revoked: true, serial: "BCSK-COMP-2026-ABC123", type: "COMPLETION", issuedAt: new Date("2026-10-01"), revokedAt });
    expect(res).not.toHaveProperty("studentName");
    const ok = await new DocumentService(certPrisma(cert()) as never).verify("BCSK-COMP-2026-ABC123");
    expect(ok).toMatchObject({ valid: true, studentName: "Rahim" });
  });
});

/* ------------------------------------------------------------------ routes */

describe("results and certificates routes", () => {
  it("keeps withholding with whoever publishes", async () => {
    for (const h of ["withhold", "release"]) {
      await expect(run(ResultController, h, hm, "POST")).resolves.toBe(true);
      await expect(run(ResultController, h, actorOf("ADMIN_SUPPORT"), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("issues and revokes certificates under certificates:issue: Head Master and office, not IT", async () => {
    for (const h of ["issue", "issueSection", "revoke", "issuedTo"]) {
      await expect(run(ResultController, h, hm, "POST")).resolves.toBe(true);
      await expect(run(ResultController, h, actorOf("ADMIN_SUPPORT"), "POST")).resolves.toBe(true);
      await expect(run(ResultController, h, actorOf("IT_SUPPORT"), "POST")).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  it("gives the CSV tabulation to staff and to teachers for their sections", async () => {
    await expect(run(ResultController, "tabulationCsv", hm)).resolves.toBe(true);
    const teacher = actorOf("TEACHER", { menus: { "office.classes": { access: true } } });
    for (const h of ["tabulationCsv", "studentPerformance"]) await expect(run(OfficeController, h, teacher)).resolves.toBe(true);
    await expect(run(OfficeController, "studentPerformance", actorOf("TEACHER", { menus: {} }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("shows a student's results to the Head Master, not to IT", async () => {
    await expect(run(ResultController, "performance", hm)).resolves.toBe(true);
    await expect(run(ResultController, "performance", actorOf("IT_SUPPORT"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
