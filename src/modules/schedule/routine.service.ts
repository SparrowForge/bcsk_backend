import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService, auditDiff } from "../../common/audit.service";
import { notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import type { Actor } from "../../common/actor";
import { assertNoClash } from "./clash";
import { currentTermCode, studentSlotsWhere, teacherSlotsWhere } from "./class-scope";
import { DAYS, type Range, type SlotInput, type SlotUpdateInput } from "./schedule.schema";

const dayIndex = (d: string) => {
  const i = (DAYS as readonly string[]).indexOf(d);
  return i < 0 ? 99 : i;
};
/** Saturday first (the school week), then by start time. */
export const byWeekTime = <T extends { dayOfWeek: string; startTime: string }>(rows: T[]) =>
  [...rows].sort((a, b) => dayIndex(a.dayOfWeek) - dayIndex(b.dayOfWeek) || a.startTime.localeCompare(b.startTime));

const slotSelect = {
  id: true, title: true, dayOfWeek: true, startTime: true, endTime: true, room: true, zoomLink: true,
  notice: true, semester: true, active: true, isLive: true, sectionId: true, subjectId: true, teacherId: true,
  section: { select: { id: true, name: true, batch: { select: { id: true, name: true, courseLevelId: true } } } },
  subject: { select: { id: true, code: true, name: true } },
  teacher: { select: { id: true, teacherId: true, user: { select: { name: true } } } },
} as const;

/**
 * The class routine: weekly slots, each one subject taught to one section by one teacher, on a
 * weekday at a time. A slot is a `ClassSession`, so attendance, assignments and online classes
 * keep hanging off it as before. Every write is checked for clashes (`clash.ts`): a teacher, a
 * section or a room in two places at once is refused with 409.
 */
@Injectable()
export class RoutineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async termCode(actor: Actor, termId?: number) {
    if (!termId) return currentTermCode(this.prisma, actor.instituteId);
    const term = await this.prisma.academicTerm.findFirst({ where: { id: termId, ...inInstitute(actor) }, select: { code: true } });
    if (!term) throw notFound("Term");
    return term.code;
  }

  async slots(actor: Actor, filter: { termId?: number; sectionId?: number; teacherProfileId?: number }) {
    const semester = await this.termCode(actor, filter.termId);
    const rows = await this.prisma.classSession.findMany({
      where: {
        semester,
        active: true,
        course: inInstitute(actor),
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
        ...(filter.teacherProfileId ? { teacherId: filter.teacherProfileId } : {}),
      },
      select: slotSelect,
    });
    return byWeekTime(rows);
  }

  private async slot(actor: Actor, id: number) {
    const row = await this.prisma.classSession.findFirst({ where: { id, course: inInstitute(actor) } });
    if (!row) throw notFound("Routine slot");
    return row;
  }

  /**
   * The teacher for a section's subject: the one asked for, who must hold that assignment; or,
   * when none is named, the only teacher assigned to it (none assigned leaves the slot open).
   */
  private async teacherFor(sectionId: number, subjectId: number, asked: number | null): Promise<number | null> {
    const assigned = await this.prisma.teacherAssignment.findMany({ where: { sectionId, subjectId }, select: { teacherProfileId: true } });
    if (asked != null) {
      if (!assigned.some((a) => a.teacherProfileId === asked)) {
        throw unprocessable("That teacher is not assigned to this subject in this section. Assign them first.");
      }
      return asked;
    }
    return assigned.length === 1 ? assigned[0]!.teacherProfileId : null;
  }

  async createSlot(actor: Actor, input: SlotInput, ip?: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: input.sectionId, batch: { term: inInstitute(actor) } },
      select: {
        id: true, name: true, active: true,
        batch: { select: { term: { select: { code: true } }, courseLevel: { select: { id: true, code: true, name: true, courseId: true } } } },
      },
    });
    if (!section) throw notFound("Section");
    if (!section.active) throw unprocessable("That section is closed.");
    const level = section.batch.courseLevel;
    const subject = await this.prisma.subject.findFirst({ where: { id: input.subjectId, ...inInstitute(actor) }, select: { id: true, name: true } });
    if (!subject) throw notFound("Subject");
    const studied = await this.prisma.curriculumSubject.findUnique({
      where: { courseLevelId_subjectId: { courseLevelId: level.id, subjectId: subject.id } },
      select: { id: true },
    });
    if (!studied) throw unprocessable(`${subject.name} is not in this class's curriculum.`);

    const teacherId = await this.teacherFor(section.id, subject.id, input.teacherProfileId);
    const semester = section.batch.term.code;
    await assertNoClash(this.prisma, {
      semester, instituteId: actor.instituteId, dayOfWeek: input.dayOfWeek, startTime: input.startTime,
      endTime: input.endTime, sectionId: section.id, teacherId, room: input.room,
    });

    const row = await this.prisma.classSession.create({
      data: {
        courseId: level.courseId,
        courseLevelId: level.id,
        // The older readers find a regular class's slots by this code (admission enrolment,
        // the class pages); section A keeps the bare code, as the backfill read it.
        classLevel: level.code ? (section.name === "A" ? level.code : `${level.code}_${section.name}`) : null,
        title: `${level.name} ${section.name} - ${subject.name}`,
        sectionId: section.id,
        subjectId: subject.id,
        teacherId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        room: input.room,
        zoomLink: input.zoomLink,
        semester,
      },
      select: slotSelect,
    });
    await this.audit.record(actor.userId, "ROUTINE_SLOT_CREATE", "ClassSession", row.id, row.title, { ip });
    return row;
  }

  async updateSlot(actor: Actor, id: number, input: SlotUpdateInput, ip?: string) {
    const before = await this.slot(actor, id);
    if (!before.active) throw unprocessable("This slot has been removed from the routine.");
    const teacherId = before.sectionId != null && before.subjectId != null
      ? await this.teacherFor(before.sectionId, before.subjectId, input.teacherProfileId)
      : input.teacherProfileId;
    await assertNoClash(this.prisma, {
      id, semester: before.semester, instituteId: actor.instituteId, dayOfWeek: input.dayOfWeek,
      startTime: input.startTime, endTime: input.endTime, sectionId: before.sectionId, teacherId, room: input.room,
    });
    const { teacherProfileId: _t, ...rest } = input;
    const data = { ...rest, teacherId };
    const row = await this.prisma.classSession.update({ where: { id }, data, select: slotSelect });
    await this.audit.record(actor.userId, "ROUTINE_SLOT_EDIT", "ClassSession", id, row.title, { ip, diff: auditDiff(before, data) });
    return row;
  }

  /**
   * Take a slot off the routine. It is switched off rather than deleted: its attendance,
   * assignments and recordings stay attached and readable.
   */
  async removeSlot(actor: Actor, id: number, ip?: string) {
    const row = await this.slot(actor, id);
    await this.prisma.classSession.update({ where: { id }, data: { active: false, isLive: false, liveSince: null } });
    await this.audit.record(actor.userId, "ROUTINE_SLOT_REMOVE", "ClassSession", id, row.title, { ip });
    return { id, active: false };
  }

  /** A teacher's own week this term: the slots that name them or their section-subject assignments. */
  async teacherWeek(actor: Actor) {
    const semester = await currentTermCode(this.prisma, actor.instituteId);
    const rows = await this.prisma.classSession.findMany({
      where: { AND: [await teacherSlotsWhere(this.prisma, actor), { semester, active: true }] },
      select: slotSelect,
    });
    return byWeekTime(rows);
  }

  /** A student's own week this term: their sections' slots and any they are enrolled in directly. */
  async studentWeek(actor: Actor) {
    const semester = await currentTermCode(this.prisma, actor.instituteId);
    const rows = await this.prisma.classSession.findMany({ where: studentSlotsWhere(actor, semester), select: slotSelect });
    return byWeekTime(rows);
  }

  /** Every online class of the institute in a range, for the Head Master to monitor. */
  onlineClasses(actor: Actor, range: Range) {
    return this.prisma.onlineClass.findMany({
      where: { classSession: { course: inInstitute(actor) }, startsAt: { gte: range.from, lte: new Date(range.to.getTime() + 86_400_000) } },
      orderBy: { startsAt: "asc" },
      take: 500,
      select: {
        id: true, topic: true, startsAt: true, endsAt: true, status: true, startedAt: true, endedAt: true,
        classSession: { select: { id: true, title: true, teacher: { select: { user: { select: { name: true } } } } } },
        _count: { select: { joins: true } },
      },
    });
  }
}
