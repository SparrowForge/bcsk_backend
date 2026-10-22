import "reflect-metadata";
import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthGuard } from "../src/common/guards/auth.guard";
import type { Role } from "../src/common/constants";
import type { Actor } from "../src/common/actor";
import { AnalyticsService, gradeDistribution, mean } from "../src/modules/analytics/analytics.service";
import { AnalyticsController } from "../src/modules/analytics/analytics.controller";
import { MarksService } from "../src/modules/exam/marks.service";
import { bengaliRuns, fontPath, scriptsIn } from "../src/common/pdf-fonts";
import { certificatesPdf } from "../src/modules/result/result-pdf";
import { assertPrintable } from "../src/modules/result/templates";

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

/* ------------------------------------------------------------------ audit coverage */

/**
 * The B7 acceptance rule: every sensitive action in the technical document's audit list writes an
 * audit row. Checked against the source, so a refactor that drops one fails here.
 */
const REQUIRED_AUDIT_ACTIONS = [
  // sign-in and accounts
  "LOGIN", "LOGIN_FAILED", "USER_CREATE", "USER_PASSWORD_RESET", "USER_DEACTIVATE", "PASSWORD_CHANGE",
  // roles and permissions
  "MENU_PERMISSIONS_SET", "MENU_PERMISSIONS_CLEAR",
  // marks and results
  "MARKS_SUBMIT", "MARKS_REOPEN", "MARKS_EDIT_AFTER_SUBMIT",
  "RESULTS_PROCESS", "RESULTS_APPROVE", "RESULTS_RETURN", "RESULTS_PUBLISH", "RESULTS_WITHDRAW",
  // leave and transfer decisions
  "LEAVE_APPROVE", "LEAVE_REJECT", "TRANSFER_VERIFY", "TRANSFER_APPROVE", "TRANSFER_REJECT",
  // documents
  "CERTIFICATE_ISSUE", "CERTIFICATE_ISSUE_BULK", "TEMPLATE_SAVE",
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "vendor" ? [] : sources(p);
    return p.endsWith(".ts") ? [readFileSync(p, "utf8")] : [];
  });
}

describe("audit coverage", () => {
  const code = sources(join(__dirname, "..", "src")).join("\n");
  it.each(REQUIRED_AUDIT_ACTIONS)("writes an audit row for %s", (action) => {
    const quoted = new RegExp(`audit\\.record\\([^;]*["'\`]${action}["'\`]`, "s");
    const ternary = new RegExp(`["'\`]${action}["'\`]`); // actions chosen by a ternary inside the call
    expect(quoted.test(code) || (ternary.test(code) && code.includes("audit.record("))).toBe(true);
  });
});

/* ------------------------------------------------------------------ marks edited after submission */

describe("marks edited after a reopen", () => {
  const past = new Date(Date.now() - 2 * 86_400_000);
  const prismaFor = (reopenedAt: Date | null) => ({
    examPaper: { findFirst: vi.fn(async () => ({ id: 11, courseLevelId: 3, subjectId: 2, examinerId: 5, fullMarks: 100, passMarks: 33, date: past, startTime: "10:00", exam: { id: 1, name: "Half-yearly", status: "SCHEDULED", termId: 1 }, subject: { name: "Bangla" } })) },
    section: { findFirst: vi.fn(async () => ({ id: 10, name: "A" })) },
    teacherProfile: { findUnique: vi.fn(async () => ({ id: 5 })) },
    markSheet: { findUnique: vi.fn(async () => ({ id: 99, status: "DRAFT", reopenedAt })), upsert: vi.fn((a: unknown) => a) },
    sectionEnrollment: { findMany: vi.fn(async () => [{ studentUserId: 900 }, { studentUserId: 901 }]) },
    mark: {
      findMany: vi.fn(async () => [{ studentUserId: 900, obtained: 40, isAbsent: false }, { studentUserId: 901, obtained: 70, isAbsent: false }]),
      upsert: vi.fn((a: unknown) => a), deleteMany: vi.fn((a: unknown) => a),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  });
  const entries = [{ studentUserId: 900, obtained: 45, isAbsent: false }, { studentUserId: 901, obtained: 70, isAbsent: false }];

  it("records exactly the marks that changed, old and new", async () => {
    const audit = { record: vi.fn() };
    await new MarksService(prismaFor(new Date()) as never, audit as never).save(actorOf("TEACHER"), 11, 10, entries);
    expect(audit.record).toHaveBeenCalledWith(7, "MARKS_EDIT_AFTER_SUBMIT", "MarkSheet", "11/10", "1 mark(s) changed", {
      diff: { before: { "900": 40 }, after: { "900": 45 } },
    });
  });
  it("does not audit first-time entry, before any submission", async () => {
    const audit = { record: vi.fn() };
    await new MarksService(prismaFor(null) as never, audit as never).save(actorOf("TEACHER"), 11, 10, entries);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ analytics */

describe("analytics", () => {
  it("lists every grade of the scheme in order, with zero counts kept", () => {
    expect(gradeDistribution(["A", "A+", "A", "F"], ["A+", "A", "B", "F"])).toEqual([
      { grade: "A+", count: 1 }, { grade: "A", count: 2 }, { grade: "B", count: 0 }, { grade: "F", count: 1 },
    ]);
    expect(mean([4, 5, 4.5])).toBe(4.5);
    expect(mean([])).toBeNull();
  });

  it("reads only the actor's institute for the overview", async () => {
    const calls: unknown[] = [];
    const spy = (value: unknown) => vi.fn(async (args: unknown) => { calls.push(args); return value; });
    const prisma = {
      academicTerm: { findFirst: spy({ code: "2026-2" }) },
      user: { count: spy(5) },
      section: { count: spy(3) },
      classSession: { findMany: spy([{ id: 50, title: "Class 3 A - Bangla", startTime: "10:00", _count: { attendances: 0 } }, { id: 51, title: "Class 3 A - Maths", startTime: "11:00", _count: { attendances: 4 } }]) },
      attendance: { findMany: spy([{ date: new Date(), status: "PRESENT" }, { date: new Date(), status: "ABSENT" }]) },
      leaveApplication: { count: spy(2) },
      transferApplication: { groupBy: spy([{ status: "SUBMITTED", _count: 1 }, { status: "VERIFIED", _count: 2 }]) },
      examPaper: { count: spy(4) },
      markSheet: { count: spy(6) },
      sectionResult: { groupBy: spy([{ status: "PROCESSED", _count: 3 }]) },
      question: { count: spy(1) },
    };
    const res = await new AnalyticsService(prisma as never).overview(actorOf("HEAD_MASTER", 4));
    expect(res.today).toEqual({ classes: 2, unmarked: [{ classSessionId: 50, title: "Class 3 A - Bangla", startTime: "10:00" }] });
    expect(res.waiting).toMatchObject({ leaveToDecide: 4, transfersToClear: 1, transfersToDecide: 2, markSheetsOverdue: 6, resultsToApprove: 3, resultsToPublish: 0 });
    expect(res.attendance.last30Days.rate).toBe(50);
    const text = JSON.stringify(calls.slice(1));
    expect(text).toContain('"instituteId":4');
    expect(text).not.toMatch(/"instituteId":(?!4)\d/);
  });

  it("breaks an exam's results down by section and subject, weakest subject first", async () => {
    const prisma = {
      exam: { findFirst: vi.fn(async () => ({ id: 1, name: "Half-yearly", gradingScheme: { kind: "GPA", bands: [{ grade: "A+" }, { grade: "A" }, { grade: "F" }] } })) },
      resultSummary: {
        findMany: vi.fn(async () => [
          { sectionId: 10, passed: true, gpa: 5, grade: "A+", percent: 85, lines: [{ subjectName: "Bangla", passed: true, percent: 85, isAbsent: false }, { subjectName: "Maths", passed: true, percent: 85, isAbsent: false }] },
          { sectionId: 10, passed: false, gpa: 0, grade: "F", percent: 30, lines: [{ subjectName: "Bangla", passed: true, percent: 60, isAbsent: false }, { subjectName: "Maths", passed: false, percent: 0, isAbsent: true }] },
        ]),
      },
      section: { findMany: vi.fn(async () => [{ id: 10, name: "A", batch: { courseLevel: { name: "Class 3" } } }]) },
    };
    const res = await new AnalyticsService(prisma as never).examResults(actorOf("HEAD_MASTER"), 1);
    expect(res.overall).toMatchObject({ students: 2, passRate: 50 });
    expect(res.bySection[0]).toMatchObject({ passRate: 50, meanGpa: 5 }); // mean GPA of those who passed
    expect(res.bySubject.map((s) => [s.subject, s.passRate, s.absent])).toEqual([["Maths", 50, 1], ["Bangla", 100, 0]]);
  });

  it("is the Head Master's alone", async () => {
    await expect(run(AnalyticsController, "overview", actorOf("HEAD_MASTER"))).resolves.toBe(true);
    for (const role of ["ADMIN_SUPPORT", "IT_SUPPORT", "TEACHER", "STUDENT"] as Role[]) {
      await expect(run(AnalyticsController, "overview", actorOf(role))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

/* ------------------------------------------------------------------ PDF fonts */

describe("PDF fonts", () => {
  it("knows which scripts a text needs", () => {
    expect(scriptsIn("Arif Rahman")).toEqual([]);
    expect(scriptsIn("আরিফ রহমান")).toEqual(["bengali"]);
    expect(scriptsIn("방글라데시 커뮤니티 스쿨")).toEqual(["korean"]);
  });
  it("finds a font only when its file is installed", () => {
    const dir = mkdtempSync(join(tmpdir(), "fonts-"));
    expect(fontPath("bengali", dir)).toBeNull();
    writeFileSync(join(dir, "NotoSansBengali-Regular.ttf"), "");
    expect(fontPath("bengali", dir)).toBe(join(dir, "NotoSansBengali-Regular.ttf"));
  });
  it("ships both fonts, so Bengali and Korean print; scripts no font covers are still refused", () => {
    expect(fontPath("bengali")).not.toBeNull();
    expect(fontPath("korean")).not.toBeNull();
    expect(() => assertPrintable("bn", "সমাপনী সনদপত্র। আরিফ রহমান, BCSK-2026-0001")).not.toThrow();
    expect(() => assertPrintable("ko", "방글라데시 커뮤니티 스쿨 수료증")).not.toThrow();
    expect(() => assertPrintable("en", "中文")).toThrow(/cannot print/);
    expect(() => assertPrintable("en", "Arif Rahman - Class 2")).not.toThrow();
  });
  it("splits mixed Bengali and Latin into runs, keeping spaces with the run they sit in", () => {
    expect(bengaliRuns("আইডি BCSK-2026-0001, স্কুল-এর")).toEqual([
      { text: "আইডি ", bengali: true },
      { text: "BCSK-2026-0001, ", bengali: false },
      { text: "স্কুল", bengali: true },
      { text: "-", bengali: false },
      { text: "এর", bengali: true },
    ]);
    // The danda ends a Bengali sentence and is drawn by the Bengali font.
    expect(bengaliRuns("করি।")).toEqual([{ text: "করি।", bengali: true }]);
  });
  it("draws a Bengali certificate with Latin mixed in", async () => {
    const pdf = await certificatesPdf({ name: "BCSK" }, [{
      title: "সমাপনী সনদপত্র", body: "এই মর্মে প্রত্যয়ন করা যাচ্ছে যে আরিফ রহমান, শিক্ষার্থী আইডি BCSK-2026-0001, সফলভাবে সম্পন্ন করেছে।",
      signatoryName: "ড. মনোয়ার হোসেন", signatoryTitle: "প্রধান শিক্ষক", serial: "BCSK-COMP-2026-ABCDEFGHJK",
    }]);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.includes(Buffer.from("NotoSansBengali"))).toBe(true); // the font is embedded
  });
});
