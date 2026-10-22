import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, forbidden, notFound, unprocessable } from "../../common/errors/app-error";
import { actorHas, type Actor } from "../../common/actor";
import { inInstitute } from "../../common/institute-scope";
import { assertTeaches } from "../structure/teaching-scope";
import { computeResults } from "./compute";

/** A result's own figures - without the withholding columns, which a student never sees. */
const studentFields = {
  id: true, examId: true, rollNo: true, totalObtained: true, totalFull: true, percent: true, gpa: true, grade: true,
  passed: true, failedSubjects: true, sectionPosition: true, classPosition: true, createdAt: true,
} as const;

const summaryInclude = {
  student: { select: { name: true, studentProfile: { select: { studentId: true } } } },
  lines: { orderBy: { id: "asc" as const } },
} as const;

/**
 * Results: from submitted marks to published results.
 *
 *  1. process - for one exam and one class, once every section's marks for every paper are
 *     submitted: compute each student's subjects, totals, GPA or grade, and places (`compute.ts`).
 *     Each section's results become PROCESSED. Re-processing is allowed until a section is approved.
 *  2. approve - the Head Master accepts one section's results; its mark sheets lock for good.
 *     return - or sends them back: its mark sheets reopen for the teachers, with the reason.
 *  3. publish - the section's students see their results; the older results table is written too,
 *     so the student portal's existing Results page shows them. withdraw - undo a publication.
 *
 * Approving needs `results:approve`; publishing and withdrawing `results:publish`. Every step is
 * audited. Students only ever read PUBLISHED results; teachers read their own sections' once
 * processed; the Head Master reads everything.
 */
@Injectable()
export class ResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async exam(actor: Actor, examId: number) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, ...inInstitute(actor) },
      include: { term: { select: { code: true, name: true } }, gradingScheme: { include: { bands: true } } },
    });
    if (!exam) throw notFound("Exam");
    return exam;
  }

  private async sectionResult(actor: Actor, examId: number, sectionId: number) {
    await this.exam(actor, examId);
    const row = await this.prisma.sectionResult.findUnique({ where: { examId_sectionId: { examId, sectionId } } });
    if (!row) throw notFound("Results for this section");
    return row;
  }

  /** Every section sitting the exam, with its marks progress and result state. */
  async overview(actor: Actor, examId: number) {
    const exam = await this.exam(actor, examId);
    const papers = await this.prisma.examPaper.findMany({ where: { examId }, select: { id: true, courseLevelId: true, sheets: { select: { sectionId: true, status: true } } } });
    const levelIds = [...new Set(papers.map((p) => p.courseLevelId))];
    const [sections, results] = await Promise.all([
      this.prisma.section.findMany({
        where: { active: true, batch: { termId: exam.termId, courseLevelId: { in: levelIds } } },
        select: { id: true, name: true, batch: { select: { courseLevelId: true, courseLevel: { select: { name: true } } } } },
        orderBy: [{ batchId: "asc" }, { name: "asc" }],
      }),
      this.prisma.sectionResult.findMany({ where: { examId } }),
    ]);
    return sections.map((s) => {
      const levelPapers = papers.filter((p) => p.courseLevelId === s.batch.courseLevelId);
      const submitted = levelPapers.filter((p) => p.sheets.some((x) => x.sectionId === s.id && x.status !== "DRAFT")).length;
      const result = results.find((r) => r.sectionId === s.id);
      return {
        sectionId: s.id, section: s.name, courseLevelId: s.batch.courseLevelId, className: s.batch.courseLevel.name,
        papers: levelPapers.length, papersSubmitted: submitted, status: result?.status ?? "NOT_PROCESSED", note: result?.note ?? null,
      };
    });
  }

  async process(actor: Actor, examId: number, courseLevelId: number, ip?: string) {
    const exam = await this.exam(actor, examId);
    if (exam.status !== "SCHEDULED") throw unprocessable(`This exam is ${exam.status.toLowerCase()}.`);
    const papers = await this.prisma.examPaper.findMany({
      where: { examId, courseLevelId },
      orderBy: { id: "asc" },
      select: { id: true, subjectId: true, fullMarks: true, passMarks: true, subject: { select: { name: true } }, sheets: { select: { sectionId: true, status: true } } },
    });
    if (papers.length === 0) throw notFound("Papers for this class");
    const sections = await this.prisma.section.findMany({
      where: { active: true, batch: { termId: exam.termId, courseLevelId } },
      select: { id: true, name: true },
    });
    if (sections.length === 0) throw unprocessable("No section of this class sits this exam.");

    const missing = sections.flatMap((s) =>
      papers.filter((p) => !p.sheets.some((x) => x.sectionId === s.id && x.status !== "DRAFT")).map((p) => `${p.subject.name} (section ${s.name})`));
    if (missing.length > 0) throw unprocessable(`Marks are not submitted yet for ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.`, { missing: missing.length });

    const settled = await this.prisma.sectionResult.count({ where: { examId, sectionId: { in: sections.map((s) => s.id) }, status: { in: ["APPROVED", "PUBLISHED"] } } });
    if (settled > 0) throw conflict("Some sections of this class are already approved; their places would change. Withdraw or return them first.");

    const [placements, marks, curriculum, institute] = await Promise.all([
      this.prisma.sectionEnrollment.findMany({ where: { sectionId: { in: sections.map((s) => s.id) }, status: "ACTIVE" }, select: { studentUserId: true, sectionId: true, rollNo: true } }),
      this.prisma.mark.findMany({ where: { paperId: { in: papers.map((p) => p.id) } }, select: { paperId: true, studentUserId: true, obtained: true, isAbsent: true } }),
      this.prisma.curriculumSubject.findMany({ where: { courseLevelId, subjectId: { in: papers.map((p) => p.subjectId) } }, select: { subjectId: true, isOptional: true } }),
      this.prisma.institute.findUniqueOrThrow({ where: { id: actor.instituteId }, select: { rankTies: true } }),
    ]);
    const optional = new Set(curriculum.filter((c) => c.isOptional).map((c) => c.subjectId));
    const computed = computeResults(
      papers.map((p) => ({ paperId: p.id, subjectName: p.subject.name, fullMarks: p.fullMarks, passMarks: p.passMarks, isOptional: optional.has(p.subjectId) })),
      placements.map((pl) => ({ ...pl, marks: marks.filter((m) => m.studentUserId === pl.studentUserId) })),
      { kind: exam.gradingScheme.kind, bands: exam.gradingScheme.bands },
      institute.rankTies,
    );

    const sectionIds = sections.map((s) => s.id);
    // A withheld result stays withheld through re-processing; only `release` lifts it.
    const held = new Map((await this.prisma.resultSummary.findMany({
      where: { examId, sectionId: { in: sectionIds }, withheld: true },
      select: { studentUserId: true, withheld: true, withheldReason: true, withheldAt: true, withheldById: true },
    })).map(({ studentUserId, ...h }) => [studentUserId, h]));
    await this.prisma.$transaction([
      this.prisma.resultSummary.deleteMany({ where: { examId, sectionId: { in: sectionIds } } }),
      ...computed.map(({ lines, ...s }) => this.prisma.resultSummary.create({ data: { ...s, ...held.get(s.studentUserId), examId, lines: { create: lines } } })),
      ...sectionIds.map((sectionId) => this.prisma.sectionResult.upsert({
        where: { examId_sectionId: { examId, sectionId } },
        create: { examId, sectionId, processedById: actor.userId },
        update: { status: "PROCESSED", processedAt: new Date(), processedById: actor.userId, note: null, approvedAt: null, approvedById: null },
      })),
    ]);
    await this.audit.record(actor.userId, "RESULTS_PROCESS", "Exam", examId, `class ${courseLevelId}: ${computed.length} students, ${sections.length} sections`, { ip });
    return { examId, courseLevelId, students: computed.length, sections: sectionIds.length, passed: computed.filter((c) => c.passed).length };
  }

  async approve(actor: Actor, examId: number, sectionId: number, ip?: string) {
    const row = await this.sectionResult(actor, examId, sectionId);
    if (row.status !== "PROCESSED") throw conflict(`These results are ${row.status.toLowerCase()}; only processed results can be approved.`);
    await this.prisma.$transaction([
      this.prisma.sectionResult.update({ where: { id: row.id }, data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() } }),
      this.prisma.markSheet.updateMany({ where: { sectionId, paper: { examId } }, data: { status: "LOCKED" } }),
    ]);
    await this.audit.record(actor.userId, "RESULTS_APPROVE", "SectionResult", row.id, `exam ${examId}, section ${sectionId}`, { ip, diff: { before: { status: "PROCESSED" }, after: { status: "APPROVED" } } });
    return { examId, sectionId, status: "APPROVED" };
  }

  /** Send a section's results back: its mark sheets reopen for the teachers with the reason. */
  async returnToTeachers(actor: Actor, examId: number, sectionId: number, note: string, ip?: string) {
    const row = await this.sectionResult(actor, examId, sectionId);
    if (row.status !== "PROCESSED") throw conflict(`These results are ${row.status.toLowerCase()}; only processed results can be returned.`);
    await this.prisma.$transaction([
      this.prisma.sectionResult.update({ where: { id: row.id }, data: { status: "RETURNED", note } }),
      this.prisma.resultSummary.deleteMany({ where: { examId, sectionId } }),
      this.prisma.markSheet.updateMany({
        where: { sectionId, paper: { examId } },
        data: { status: "DRAFT", reopenedById: actor.userId, reopenedAt: new Date(), reopenReason: note },
      }),
    ]);
    await this.audit.record(actor.userId, "RESULTS_RETURN", "SectionResult", row.id, note, { ip, diff: { before: { status: "PROCESSED" }, after: { status: "RETURNED" } } });
    return { examId, sectionId, status: "RETURNED" };
  }

  async publish(actor: Actor, examId: number, sectionId: number, ip?: string) {
    const exam = await this.exam(actor, examId);
    const row = await this.sectionResult(actor, examId, sectionId);
    if (row.status !== "APPROVED") throw conflict(row.status === "PUBLISHED" ? "These results are already published." : "Approve these results before publishing them.");
    const all = await this.prisma.resultSummary.findMany({ where: { examId, sectionId }, include: { lines: true } });
    // A withheld student is neither shown the result nor told it is out; `release` does both later.
    const summaries = all.filter((s) => !s.withheld);
    await this.prisma.$transaction([
      this.prisma.sectionResult.update({ where: { id: row.id }, data: { status: "PUBLISHED", publishedById: actor.userId, publishedAt: new Date(), note: null } }),
      ...this.projectAndNotify(exam, summaries),
    ]);
    await this.audit.record(actor.userId, "RESULTS_PUBLISH", "SectionResult", row.id, `exam ${examId}, section ${sectionId}: ${summaries.length} students${all.length > summaries.length ? `, ${all.length - summaries.length} withheld` : ""}`, { ip });
    return { examId, sectionId, status: "PUBLISHED", students: summaries.length, withheld: all.length - summaries.length };
  }

  /**
   * The writes that show published results to students: the older results table (it keeps the
   * student portal's Results page and result-sheet PDF working) and a notification each.
   */
  private projectAndNotify(
    exam: { id: number; name: string; term: { code: string } },
    summaries: { studentUserId: number; gpa: number | null; grade: string; lines: { subjectName: string; fullMarks: number; obtained: number | null; grade: string; isAbsent: boolean }[] }[],
  ) {
    if (summaries.length === 0) return [];
    const projection = summaries.flatMap((s) => s.lines.map((l) => ({
      studentUserId: s.studentUserId, semester: exam.term.code, subject: `${exam.name}: ${l.subjectName}`,
      fullMarks: l.fullMarks, marks: l.obtained ?? 0, grade: l.grade, remark: l.isAbsent ? "Absent" : null, examId: exam.id,
    })));
    return [
      ...projection.map((p) => this.prisma.examResult.upsert({
        where: { studentUserId_semester_subject: { studentUserId: p.studentUserId, semester: p.semester, subject: p.subject } },
        create: p,
        update: { fullMarks: p.fullMarks, marks: p.marks, grade: p.grade, remark: p.remark, examId: exam.id },
      })),
      this.prisma.notification.createMany({
        data: summaries.map((s) => ({
          userId: s.studentUserId, kind: "GENERAL", title: `Results published: ${exam.name}`,
          body: `${s.gpa != null ? `GPA ${s.gpa.toFixed(2)}, ` : ""}grade ${s.grade}`, link: "/classroom/results",
        })),
      }),
    ];
  }

  /**
   * Hold back one student's result - unpaid dues, a disciplinary case - with a reason. Allowed at
   * any state from processed on; if the section is already published the student's rows in the
   * older results table go with it. Their places stay as computed, so nobody else's change.
   */
  async withhold(actor: Actor, examId: number, studentUserId: number, reason: string, ip?: string) {
    const summary = await this.ownSummary(actor, examId, studentUserId);
    if (summary.withheld) throw conflict("This result is already withheld.");
    const state = await this.sectionResult(actor, examId, summary.sectionId);
    if (state.status === "RETURNED") throw unprocessable("These results were returned to the teachers and must be processed again.");
    await this.prisma.$transaction([
      this.prisma.resultSummary.update({ where: { id: summary.id }, data: { withheld: true, withheldReason: reason, withheldAt: new Date(), withheldById: actor.userId } }),
      ...(state.status === "PUBLISHED" ? [this.prisma.examResult.deleteMany({ where: { examId, studentUserId } })] : []),
    ]);
    await this.audit.record(actor.userId, "RESULT_WITHHOLD", "ResultSummary", summary.id, reason, { ip, diff: { before: { withheld: false }, after: { withheld: true, reason } } });
    return { examId, studentUserId, withheld: true };
  }

  /** Release a withheld result. If the section is published the student sees it now, and is told. */
  async release(actor: Actor, examId: number, studentUserId: number, ip?: string) {
    const summary = await this.ownSummary(actor, examId, studentUserId);
    if (!summary.withheld) throw conflict("This result is not withheld.");
    const state = await this.sectionResult(actor, examId, summary.sectionId);
    const exam = await this.exam(actor, examId);
    await this.prisma.$transaction([
      this.prisma.resultSummary.update({ where: { id: summary.id }, data: { withheld: false, withheldReason: null, withheldAt: null, withheldById: null } }),
      ...(state.status === "PUBLISHED" ? this.projectAndNotify(exam, [summary]) : []),
    ]);
    await this.audit.record(actor.userId, "RESULT_RELEASE", "ResultSummary", summary.id, summary.withheldReason ?? undefined, { ip, diff: { before: { withheld: true }, after: { withheld: false } } });
    return { examId, studentUserId, withheld: false };
  }

  /** One student's result in an exam of the actor's institute, with its lines. */
  private async ownSummary(actor: Actor, examId: number, studentUserId: number) {
    await this.exam(actor, examId);
    const summary = await this.prisma.resultSummary.findUnique({ where: { examId_studentUserId: { examId, studentUserId } }, include: { lines: true } });
    if (!summary) throw notFound("Result");
    return summary;
  }

  /** Take published results down again, with a reason. They return to APPROVED. */
  async withdraw(actor: Actor, examId: number, sectionId: number, note: string, ip?: string) {
    const row = await this.sectionResult(actor, examId, sectionId);
    if (row.status !== "PUBLISHED") throw conflict("Only published results can be withdrawn.");
    const students = (await this.prisma.resultSummary.findMany({ where: { examId, sectionId }, select: { studentUserId: true } })).map((s) => s.studentUserId);
    await this.prisma.$transaction([
      this.prisma.sectionResult.update({ where: { id: row.id }, data: { status: "APPROVED", note, publishedAt: null, publishedById: null } }),
      this.prisma.examResult.deleteMany({ where: { examId, studentUserId: { in: students } } }),
    ]);
    await this.audit.record(actor.userId, "RESULTS_WITHDRAW", "SectionResult", row.id, note, { ip, diff: { before: { status: "PUBLISHED" }, after: { status: "APPROVED" } } });
    return { examId, sectionId, status: "APPROVED" };
  }

  /** How equal results are placed in this institute: SHARED (1, 1, 3) or SPLIT (1, 2, 3). */
  async setRankTies(actor: Actor, rankTies: "SHARED" | "SPLIT", ip?: string) {
    const before = await this.prisma.institute.findUniqueOrThrow({ where: { id: actor.instituteId }, select: { rankTies: true } });
    await this.prisma.institute.update({ where: { id: actor.instituteId }, data: { rankTies } });
    await this.audit.record(actor.userId, "RESULTS_SETTINGS", "Institute", actor.instituteId, undefined, { ip, diff: { before, after: { rankTies } } });
    return { rankTies };
  }

  /* ----------------------------------------------------------------- reading */

  /** Who may read a section's results, and from which state on. */
  private async assertCanReadSection(actor: Actor, examId: number, sectionId: number) {
    const row = await this.sectionResult(actor, examId, sectionId);
    if (actorHas(actor, "reports:manage") || actorHas(actor, "results:approve")) return row;
    if (actor.role === "TEACHER") {
      await assertTeaches(this.prisma, actor, sectionId);
      return row;
    }
    throw forbidden();
  }

  /** Everything a tabulation sheet or result sheet needs for one section. */
  async sectionReport(actor: Actor, examId: number, sectionId: number) {
    const state = await this.assertCanReadSection(actor, examId, sectionId);
    if (state.status === "RETURNED") throw unprocessable("These results were returned to the teachers and must be processed again.");
    return this.reportData(examId, sectionId, state.status);
  }

  private async reportData(examId: number, sectionId: number, status: string) {
    const [exam, section, summaries] = await Promise.all([
      this.prisma.exam.findUniqueOrThrow({
        where: { id: examId },
        select: { id: true, name: true, term: { select: { code: true, name: true } }, gradingScheme: { select: { name: true, kind: true } }, institute: { select: { name: true, address: true, phone: true, email: true, headMasterName: true } } },
      }),
      this.prisma.section.findUniqueOrThrow({ where: { id: sectionId }, select: { name: true, batch: { select: { courseLevel: { select: { name: true, course: { select: { name: true } } } } } } } }),
      this.prisma.resultSummary.findMany({ where: { examId, sectionId }, include: summaryInclude, orderBy: [{ rollNo: { sort: "asc", nulls: "last" } }, { id: "asc" }] }),
    ]);
    const subjects = [...new Set(summaries.flatMap((s) => s.lines.map((l) => l.subjectName)))];
    return { exam, status, section: section.name, className: `${section.batch.courseLevel.course.name} - ${section.batch.courseLevel.name}`, subjects, summaries };
  }

  /** One student's result: theirs once published; staff and their teachers once processed. */
  async studentResult(actor: Actor, examId: number, studentUserId: number) {
    const summary = await this.prisma.resultSummary.findUnique({ where: { examId_studentUserId: { examId, studentUserId } }, select: { sectionId: true, withheld: true } });
    if (!summary) throw notFound("Result");
    if (actor.role === "STUDENT") {
      if (actor.userId !== studentUserId) throw notFound("Result");
      const state = await this.prisma.sectionResult.findUnique({ where: { examId_sectionId: { examId, sectionId: summary.sectionId } } });
      if (state?.status !== "PUBLISHED") throw notFound("Result");
      if (summary.withheld) throw forbidden("Your result for this exam is withheld. Please contact the school office.");
      const data = await this.reportData(examId, summary.sectionId, "PUBLISHED");
      return { ...data, summaries: data.summaries.filter((s) => s.studentUserId === studentUserId) };
    }
    const state = await this.assertCanReadSection(actor, examId, summary.sectionId);
    const data = await this.reportData(examId, summary.sectionId, state.status);
    return { ...data, summaries: data.summaries.filter((s) => s.studentUserId === studentUserId) };
  }

  /** A student's published exam results, newest first. */
  async publishedForStudent(actor: Actor) {
    const published = await this.prisma.sectionResult.findMany({ where: { status: "PUBLISHED", exam: inInstitute(actor) }, select: { examId: true, sectionId: true } });
    if (published.length === 0) return [];
    return this.prisma.resultSummary.findMany({
      where: { studentUserId: actor.userId, withheld: false, OR: published.map((p) => ({ examId: p.examId, sectionId: p.sectionId })) },
      orderBy: { id: "desc" },
      select: { ...studentFields, exam: { select: { id: true, name: true, type: true, term: { select: { code: true, name: true } } } }, lines: { orderBy: { id: "asc" } } },
    });
  }

  /**
   * One student's results across exams, for their teachers and the Head Master: every result from
   * processed on (not returned ones), withheld or not, oldest first so progress reads left to right.
   * A teacher must teach one of the student's current sections.
   */
  async studentPerformance(actor: Actor, studentUserId: number) {
    const student = await this.prisma.user.findFirst({
      where: { id: studentUserId, role: "STUDENT", ...inInstitute(actor) },
      select: { id: true, name: true, studentProfile: { select: { studentId: true } } },
    });
    if (!student) throw notFound("Student");
    if (!actorHas(actor, "students:read") && !actorHas(actor, "results:approve")) {
      if (actor.role !== "TEACHER") throw forbidden();
      const sections = await this.prisma.sectionEnrollment.findMany({ where: { studentUserId, status: "ACTIVE" }, select: { sectionId: true } });
      let teaches = false;
      for (const { sectionId } of sections) {
        if (await assertTeaches(this.prisma, actor, sectionId).then(() => true, () => false)) { teaches = true; break; }
      }
      if (!teaches) throw forbidden("You don't teach this student.");
    }
    const states = await this.prisma.sectionResult.findMany({
      where: { status: { in: ["PROCESSED", "APPROVED", "PUBLISHED"] }, exam: inInstitute(actor) },
      select: { examId: true, sectionId: true, status: true },
    });
    if (states.length === 0) return { student, results: [] };
    const summaries = await this.prisma.resultSummary.findMany({
      where: { studentUserId, OR: states.map((s) => ({ examId: s.examId, sectionId: s.sectionId })) },
      orderBy: { id: "asc" },
      select: {
        ...studentFields, sectionId: true, withheld: true, withheldReason: true,
        exam: { select: { id: true, name: true, type: true, term: { select: { code: true, name: true } } } }, lines: { orderBy: { id: "asc" } },
      },
    });
    return {
      student: { id: student.id, name: student.name, studentId: student.studentProfile?.studentId ?? null },
      results: summaries.map((s) => ({ ...s, status: states.find((x) => x.examId === s.exam.id && x.sectionId === s.sectionId)!.status })),
    };
  }
}
