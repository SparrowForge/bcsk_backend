import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService, auditDiff } from "../../common/audit.service";
import { notFound } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import { ADMIN_ROLES, DEFAULT_INSTITUTE_ID } from "../../common/constants";
import type { Actor } from "../../common/actor";
import type { EventInput, Range } from "./schedule.schema";

/** Events touching a range: they start on or before its last day and end on or after its first. */
const overlapping = (r: Range): Prisma.CalendarEventWhereInput => ({ startDate: { lte: r.to }, endDate: { gte: r.from } });
const order = [{ startDate: "asc" as const }, { id: "asc" as const }];
const publicFields = {
  id: true, title: true, description: true, type: true, audience: true, startDate: true, endDate: true,
  courseLevel: { select: { id: true, name: true } },
} as const;

/**
 * The academic calendar. The Head Master (`calendar:manage`) writes drafts and publishes them;
 * everyone else reads what is published and meant for them:
 *
 *  - students: entries for everyone or for students, and class-specific ones only for a class
 *    they are placed in this term;
 *  - teachers: entries for everyone or for teachers, any class;
 *  - staff: every published entry;
 *  - the public website: entries for everyone that name no class.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async event(actor: Actor, id: number) {
    const row = await this.prisma.calendarEvent.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Calendar entry");
    return row;
  }

  private async checkLinks(actor: Actor, input: EventInput) {
    const [term, level] = await Promise.all([
      input.termId ? this.prisma.academicTerm.findFirst({ where: { id: input.termId, ...inInstitute(actor) }, select: { id: true } }) : null,
      input.courseLevelId ? this.prisma.courseLevel.findFirst({ where: { id: input.courseLevelId, course: inInstitute(actor) }, select: { id: true } }) : null,
    ]);
    if (input.termId && !term) throw notFound("Term");
    if (input.courseLevelId && !level) throw notFound("Class");
  }

  /** The manager's view: drafts included. */
  manage(actor: Actor, range: Range) {
    return this.prisma.calendarEvent.findMany({
      where: { ...inInstitute(actor), ...overlapping(range) },
      orderBy: order,
      include: { term: { select: { id: true, code: true } }, courseLevel: { select: { id: true, name: true } } },
    });
  }

  async create(actor: Actor, input: EventInput, ip?: string) {
    await this.checkLinks(actor, input);
    const row = await this.prisma.calendarEvent.create({ data: { ...input, ...inInstitute(actor), createdById: actor.userId } });
    await this.audit.record(actor.userId, "CALENDAR_CREATE", "CalendarEvent", row.id, row.title, { ip });
    return row;
  }

  async update(actor: Actor, id: number, input: EventInput, ip?: string) {
    const before = await this.event(actor, id);
    await this.checkLinks(actor, input);
    const row = await this.prisma.calendarEvent.update({ where: { id }, data: input });
    await this.audit.record(actor.userId, before.published !== row.published && row.published ? "CALENDAR_PUBLISH" : "CALENDAR_EDIT",
      "CalendarEvent", id, row.title, { ip, diff: auditDiff(before, input) });
    return row;
  }

  async remove(actor: Actor, id: number, ip?: string) {
    const row = await this.event(actor, id);
    await this.prisma.calendarEvent.delete({ where: { id } });
    await this.audit.record(actor.userId, "CALENDAR_DELETE", "CalendarEvent", id, row.title, { ip });
    return { id };
  }

  /** What a signed-in person sees, by who they are. */
  async feed(actor: Actor, range: Range) {
    const base: Prisma.CalendarEventWhereInput = { ...inInstitute(actor), published: true, ...overlapping(range) };
    let where: Prisma.CalendarEventWhereInput;
    if (actor.role === "STUDENT") {
      const places = await this.prisma.sectionEnrollment.findMany({
        where: { studentUserId: actor.userId, status: "ACTIVE", batch: { term: { ...inInstitute(actor), isCurrent: true } } },
        select: { batch: { select: { courseLevelId: true } } },
      });
      where = {
        ...base,
        audience: { in: ["ALL", "STUDENTS"] },
        OR: [{ courseLevelId: null }, { courseLevelId: { in: places.map((p) => p.batch.courseLevelId) } }],
      };
    } else if (actor.role === "TEACHER") {
      where = { ...base, audience: { in: ["ALL", "TEACHERS"] } };
    } else if (ADMIN_ROLES.includes(actor.role)) {
      where = base;
    } else {
      where = { ...base, audience: "ALL", courseLevelId: null };
    }
    return this.prisma.calendarEvent.findMany({ where, orderBy: order, select: publicFields });
  }

  /** The public website's calendar: the school's own published entries for everyone. */
  publicFeed(range: Range) {
    return this.prisma.calendarEvent.findMany({
      where: { instituteId: DEFAULT_INSTITUTE_ID, published: true, audience: "ALL", courseLevelId: null, ...overlapping(range) },
      orderBy: order,
      select: { id: true, title: true, description: true, type: true, startDate: true, endDate: true },
    });
  }
}
