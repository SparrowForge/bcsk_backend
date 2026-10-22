import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { notFound } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import { schoolToday } from "../../common/constants";
import type { Actor } from "../../common/actor";
import { tally, weekdayOf } from "../teaching/attendance-report.service";
import { currentTermCode } from "../schedule/class-scope";
import type { Range } from "../schedule/schedule.schema";

const DAY = 86_400_000;

/** Grade counts in the scheme's order (best first), with every grade present even at 0. */
export function gradeDistribution(grades: string[], order: string[]): { grade: string; count: number }[] {
  const counts = new Map(order.map((g) => [g, 0]));
  for (const g of grades) counts.set(g, (counts.get(g) ?? 0) + 1);
  return [...counts.entries()].map(([grade, count]) => ({ grade, count }));
}

/** Mean of the numbers given, to two places; null for none. */
export const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/**
 * The Head Master's view of the institute (`analytics:read`): one overview of what needs attention
 * today, attendance by section over a range, and an exam's results by section and subject. Every
 * figure is computed from the institute's own rows in a few grouped queries - never a query per
 * student - because the database is a long round trip from the API.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(actor: Actor) {
    const today = schoolToday();
    const todayDate = new Date(`${today}T00:00:00Z`);
    const semester = await currentTermCode(this.prisma, actor.instituteId);
    const in14 = new Date(todayDate.getTime() + 14 * DAY);
    const since30 = new Date(todayDate.getTime() - 29 * DAY);

    const [
      students, teachers, sections, todaySlots, recentMarks, pendingLeave, reviewedLeave, openTransfers,
      upcomingPapers, draftSheets, resultStates, unanswered,
    ] = await Promise.all([
      this.prisma.user.count({ where: { ...inInstitute(actor), role: "STUDENT", active: true, studentProfile: { status: "ACTIVE" } } }),
      this.prisma.user.count({ where: { ...inInstitute(actor), role: "TEACHER", active: true } }),
      this.prisma.section.count({ where: { active: true, batch: { term: { ...inInstitute(actor), isCurrent: true } } } }),
      this.prisma.classSession.findMany({
        where: { semester, active: true, dayOfWeek: weekdayOf(todayDate), course: inInstitute(actor) },
        select: { id: true, title: true, startTime: true, _count: { select: { attendances: { where: { date: todayDate } } } } },
      }),
      this.prisma.attendance.findMany({
        where: { date: { gte: since30, lte: todayDate }, classSession: { course: inInstitute(actor) } },
        select: { date: true, status: true },
      }),
      this.prisma.leaveApplication.count({ where: { ...inInstitute(actor), status: "PENDING" } }),
      this.prisma.leaveApplication.count({ where: { ...inInstitute(actor), status: "REVIEWED" } }),
      this.prisma.transferApplication.groupBy({ by: ["status"], where: { ...inInstitute(actor), status: { in: ["SUBMITTED", "VERIFIED"] } }, _count: true }),
      this.prisma.examPaper.count({ where: { date: { gte: todayDate, lte: in14 }, exam: { ...inInstitute(actor), status: "SCHEDULED" } } }),
      this.prisma.markSheet.count({ where: { status: "DRAFT", paper: { date: { lt: todayDate }, exam: { ...inInstitute(actor), status: "SCHEDULED" } } } }),
      this.prisma.sectionResult.groupBy({ by: ["status"], where: { exam: inInstitute(actor) }, _count: true }),
      this.prisma.question.count({ where: { answeredAt: null, student: inInstitute(actor) } }),
    ]);

    // Attendance week by week over the last 30 days: the trend line on the dashboard.
    const weeks = new Map<string, string[]>();
    for (const m of recentMarks) {
      const start = new Date(todayDate.getTime() - Math.floor((todayDate.getTime() - m.date.getTime()) / (7 * DAY)) * 7 * DAY - 6 * DAY);
      const key = start.toISOString().slice(0, 10);
      weeks.set(key, [...(weeks.get(key) ?? []), m.status]);
    }

    return {
      date: today,
      people: { students, teachers, sections },
      today: {
        classes: todaySlots.length,
        unmarked: todaySlots.filter((s) => s._count.attendances === 0).map((s) => ({ classSessionId: s.id, title: s.title, startTime: s.startTime })),
      },
      attendance: {
        last30Days: tally(recentMarks.map((m) => m.status)),
        byWeek: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStarting, s]) => ({ weekStarting, ...tally(s) })),
      },
      waiting: {
        leaveToDecide: pendingLeave + reviewedLeave,
        leaveReviewed: reviewedLeave,
        transfersToClear: openTransfers.find((t) => t.status === "SUBMITTED")?._count ?? 0,
        transfersToDecide: openTransfers.find((t) => t.status === "VERIFIED")?._count ?? 0,
        markSheetsOverdue: draftSheets,
        resultsToApprove: resultStates.find((r) => r.status === "PROCESSED")?._count ?? 0,
        resultsToPublish: resultStates.find((r) => r.status === "APPROVED")?._count ?? 0,
        unansweredQuestions: unanswered,
      },
      upcoming: { examPapersNext14Days: upcomingPapers },
    };
  }

  /** Attendance per section of the current term over a range, lowest rate first. */
  async attendanceBySection(actor: Actor, range: Range) {
    const rows = await this.prisma.attendance.findMany({
      where: {
        date: { gte: range.from, lt: new Date(range.to.getTime() + DAY) },
        classSession: { sectionId: { not: null }, section: { batch: { term: { ...inInstitute(actor), isCurrent: true } } } },
      },
      select: { status: true, classSession: { select: { sectionId: true } } },
    });
    const sections = await this.prisma.section.findMany({
      where: { active: true, batch: { term: { ...inInstitute(actor), isCurrent: true } } },
      select: { id: true, name: true, batch: { select: { courseLevel: { select: { name: true } } } } },
    });
    const bySection = new Map<number, string[]>();
    for (const r of rows) bySection.set(r.classSession.sectionId!, [...(bySection.get(r.classSession.sectionId!) ?? []), r.status]);
    return sections
      .map((s) => ({ sectionId: s.id, section: `${s.batch.courseLevel.name} - ${s.name}`, ...tally(bySection.get(s.id) ?? []) }))
      .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));
  }

  /** An exam's results: per section pass rate, mean GPA and grades; per subject pass rate and mean. */
  async examResults(actor: Actor, examId: number) {
    const exam = await this.prisma.exam.findFirst({
      where: { id: examId, ...inInstitute(actor) },
      select: { id: true, name: true, gradingScheme: { select: { kind: true, bands: { orderBy: { minPercent: "desc" }, select: { grade: true } } } } },
    });
    if (!exam) throw notFound("Exam");
    const summaries = await this.prisma.resultSummary.findMany({
      where: { examId },
      select: {
        sectionId: true, passed: true, gpa: true, grade: true, percent: true,
        lines: { select: { subjectName: true, passed: true, percent: true, isAbsent: true } },
      },
    });
    const sections = await this.prisma.section.findMany({
      where: { id: { in: [...new Set(summaries.map((s) => s.sectionId))] } },
      select: { id: true, name: true, batch: { select: { courseLevel: { select: { name: true } } } } },
    });
    const order = exam.gradingScheme.bands.map((b) => b.grade);
    const rate = (passed: number, total: number) => (total ? Math.round((passed / total) * 1000) / 10 : null);

    const bySection = sections.map((s) => {
      const group = summaries.filter((r) => r.sectionId === s.id);
      return {
        sectionId: s.id, section: `${s.batch.courseLevel.name} - ${s.name}`, students: group.length,
        passRate: rate(group.filter((r) => r.passed).length, group.length),
        meanGpa: exam.gradingScheme.kind === "GPA" ? mean(group.filter((r) => r.passed).map((r) => r.gpa ?? 0)) : null,
        meanPercent: mean(group.map((r) => r.percent)),
        grades: gradeDistribution(group.map((r) => r.grade), order),
      };
    });
    const lines = summaries.flatMap((s) => s.lines);
    const subjects = [...new Set(lines.map((l) => l.subjectName))].map((name) => {
      const ls = lines.filter((l) => l.subjectName === name);
      return {
        subject: name, students: ls.length, passRate: rate(ls.filter((l) => l.passed).length, ls.length),
        meanPercent: mean(ls.filter((l) => !l.isAbsent).map((l) => l.percent)), absent: ls.filter((l) => l.isAbsent).length,
      };
    }).sort((a, b) => (a.passRate ?? 101) - (b.passRate ?? 101));

    return {
      exam: { id: exam.id, name: exam.name },
      overall: { students: summaries.length, passRate: rate(summaries.filter((s) => s.passed).length, summaries.length), grades: gradeDistribution(summaries.map((s) => s.grade), order) },
      bySection,
      bySubject: subjects,
    };
  }
}
