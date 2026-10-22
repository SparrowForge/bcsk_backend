import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { notFound } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import type { Actor } from "../../common/actor";
import { assertTeaches } from "../structure/teaching-scope";
import { currentTermCode, studentSlotsWhere } from "../schedule/class-scope";
import { DAYS, type Range } from "../schedule/schedule.schema";

export type Tally = { present: number; absent: number; late: number; excused: number; total: number; rate: number | null };

/**
 * Count attendance marks. A late arrival counts as attended; an excused absence (approved
 * leave) is left out of the rate entirely, so leave never lowers a student's percentage. The
 * rate is null when nothing countable was marked - "no data", not 0%.
 */
export function tally(statuses: string[]): Tally {
  const t = { present: 0, absent: 0, late: 0, excused: 0, total: statuses.length };
  for (const s of statuses) {
    if (s === "PRESENT") t.present++;
    else if (s === "ABSENT") t.absent++;
    else if (s === "LATE") t.late++;
    else if (s === "EXCUSED") t.excused++;
  }
  const counted = t.present + t.absent + t.late;
  return { ...t, rate: counted === 0 ? null : Math.round(((t.present + t.late) / counted) * 1000) / 10 };
}

const dayAfter = (d: Date) => new Date(d.getTime() + 86_400_000);
/** The school weekday of a stored day (midnight UTC stands for that calendar day). */
export const weekdayOf = (d: Date) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getUTCDay()]!;

/**
 * Attendance reports. A section's report covers every class slot of the section: one row per
 * student with their tally, and one row per day with the section's tally. The Head Master reads
 * any section and an institute-wide overview of a day; a teacher reads the sections they teach
 * or lead; a student reads only their own.
 */
@Injectable()
export class AttendanceReportService {
  constructor(private readonly prisma: PrismaService) {}

  private async sectionReport(sectionId: number, range: Range) {
    const [slots, placed] = await Promise.all([
      this.prisma.classSession.findMany({ where: { sectionId }, select: { id: true } }),
      this.prisma.sectionEnrollment.findMany({
        where: { sectionId, status: "ACTIVE" },
        orderBy: [{ rollNo: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        select: { rollNo: true, student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } } },
      }),
    ]);
    const marks = await this.prisma.attendance.findMany({
      where: { classSessionId: { in: slots.map((s) => s.id) }, date: { gte: range.from, lt: dayAfter(range.to) } },
      select: { studentUserId: true, date: true, status: true },
    });
    const byStudent = new Map<number, string[]>();
    const byDay = new Map<string, string[]>();
    for (const m of marks) {
      byStudent.set(m.studentUserId, [...(byStudent.get(m.studentUserId) ?? []), m.status]);
      const key = m.date.toISOString().slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), m.status]);
    }
    return {
      sectionId,
      from: range.from.toISOString().slice(0, 10),
      to: range.to.toISOString().slice(0, 10),
      students: placed.map((p) => ({ rollNo: p.rollNo, student: p.student, ...tally(byStudent.get(p.student.id) ?? []) })),
      days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, s]) => ({ date, ...tally(s) })),
      overall: tally(marks.map((m) => m.status)),
    };
  }

  /** Head Master: any section of the institute. */
  async forSection(actor: Actor, sectionId: number, range: Range) {
    const section = await this.prisma.section.findFirst({ where: { id: sectionId, batch: { term: inInstitute(actor) } }, select: { id: true } });
    if (!section) throw notFound("Section");
    return this.sectionReport(sectionId, range);
  }

  /** Teacher: a section they teach a subject in or lead. */
  async forTeacherSection(actor: Actor, sectionId: number, range: Range) {
    await assertTeaches(this.prisma, actor, sectionId);
    return this.sectionReport(sectionId, range);
  }

  /**
   * Head Master: one day across the institute - for every section of the current term, how many
   * of the day's classes have been marked, and the day's tally. Unmarked classes are the point.
   */
  async overview(actor: Actor, dateStr: string) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    const weekday = weekdayOf(date);
    const semester = await currentTermCode(this.prisma, actor.instituteId);
    const slots = await this.prisma.classSession.findMany({
      where: { semester, active: true, dayOfWeek: weekday, sectionId: { not: null }, course: inInstitute(actor) },
      select: {
        id: true, title: true, startTime: true, sectionId: true,
        section: { select: { name: true, batch: { select: { name: true } } } },
        teacher: { select: { user: { select: { name: true } } } },
        attendances: { where: { date }, select: { status: true } },
      },
      orderBy: [{ sectionId: "asc" }, { startTime: "asc" }],
    });
    const sections = new Map<number, { sectionId: number; section: string; classes: unknown[]; statuses: string[] }>();
    for (const s of slots) {
      const key = s.sectionId!;
      if (!sections.has(key)) sections.set(key, { sectionId: key, section: `${s.section!.batch.name} - ${s.section!.name}`, classes: [], statuses: [] });
      const entry = sections.get(key)!;
      entry.classes.push({ classSessionId: s.id, title: s.title, startTime: s.startTime, teacher: s.teacher?.user.name ?? null, marked: s.attendances.length > 0 });
      entry.statuses.push(...s.attendances.map((a) => a.status));
    }
    return {
      date: dateStr,
      weekday,
      isSchoolDay: (DAYS as readonly string[]).includes(weekday) && slots.length > 0,
      sections: [...sections.values()].map(({ statuses, ...rest }) => ({ ...rest, ...tally(statuses) })),
    };
  }

  /** Student: their own tally per class this term, and overall. */
  async forStudent(actor: Actor) {
    const semester = await currentTermCode(this.prisma, actor.instituteId);
    const slots = await this.prisma.classSession.findMany({
      where: studentSlotsWhere(actor, semester),
      select: {
        id: true, title: true, subject: { select: { name: true } },
        attendances: { where: { studentUserId: actor.userId }, select: { status: true } },
      },
    });
    return {
      classes: slots.map((s) => ({ classSessionId: s.id, title: s.title, subject: s.subject?.name ?? null, ...tally(s.attendances.map((a) => a.status)) })),
      overall: tally(slots.flatMap((s) => s.attendances.map((a) => a.status))),
    };
  }
}
