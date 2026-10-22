import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import type { Actor } from "../../common/actor";
import { assertOwnsSlot, currentTermCode, slotStudentIds, studentSlotsWhere, teacherSlotsWhere } from "./class-scope";
import type { OnlineClassInput, Range } from "./schedule.schema";

/** Students may open the link from this long before the start until the end. */
export const JOIN_EARLY_MS = 10 * 60_000;

type JoinState = { status: string; startsAt: Date; endsAt: Date };
/** Whether a student may open the link now. */
export function joinable(o: JoinState, now = new Date()): boolean {
  if (o.status === "LIVE") return true;
  if (o.status !== "SCHEDULED") return false;
  return now.getTime() >= o.startsAt.getTime() - JOIN_EARLY_MS && now.getTime() <= o.endsAt.getTime();
}

const listFields = {
  id: true, topic: true, startsAt: true, endsAt: true, status: true, startedAt: true, endedAt: true, recordingUrl: true,
  classSession: { select: { id: true, title: true, subject: { select: { name: true } }, teacher: { select: { user: { select: { name: true } } } } } },
} as const;

/**
 * Online classes: the dated meetings of a routine slot.
 *
 * A teacher schedules, starts, ends or cancels the meetings of slots they own (`class-scope.ts`).
 * Starting and ending also flip the slot's `isLive`, so the homepage boards - which read it -
 * stay in step. Students see their own meetings without the link; the link is handed out by
 * `join`, which checks the student belongs and that the meeting is open, and logs the join.
 */
@Injectable()
export class OnlineClassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async owned(actor: Actor, id: number) {
    const row = await this.prisma.onlineClass.findUnique({ where: { id } });
    if (!row) throw notFound("Online class");
    const slot = await assertOwnsSlot(this.prisma, actor, row.classSessionId);
    return { row, slot };
  }

  /* ----------------------------------------------------------------- teacher */

  async schedule(actor: Actor, classSessionId: number, input: OnlineClassInput) {
    const slot = await assertOwnsSlot(this.prisma, actor, classSessionId);
    if (!slot.active) throw unprocessable("This class is no longer on the routine.");
    const overlap = await this.prisma.onlineClass.findFirst({
      where: { classSessionId, status: { in: ["SCHEDULED", "LIVE"] }, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
      select: { id: true },
    });
    if (overlap) throw conflict("This class already has an online meeting at that time.");
    const row = await this.prisma.onlineClass.create({
      data: { classSessionId, ...input, joinUrl: input.joinUrl ?? slot.zoomLink, createdById: actor.userId },
    });
    await this.audit.record(actor.userId, "ONLINE_CLASS_SCHEDULE", "OnlineClass", row.id, slot.title);
    return row;
  }

  async mine(actor: Actor, range: Range) {
    return this.prisma.onlineClass.findMany({
      where: {
        classSession: await teacherSlotsWhere(this.prisma, actor),
        startsAt: { gte: range.from, lte: new Date(range.to.getTime() + 86_400_000) },
      },
      orderBy: { startsAt: "asc" },
      take: 300,
      select: { ...listFields, joinUrl: true, _count: { select: { joins: true } } },
    });
  }

  async start(actor: Actor, id: number) {
    const { row, slot } = await this.owned(actor, id);
    if (row.status === "LIVE") return row;
    if (row.status !== "SCHEDULED") throw conflict(`This class is ${row.status.toLowerCase()}.`);
    const now = new Date();
    const [started] = await this.prisma.$transaction([
      this.prisma.onlineClass.update({ where: { id }, data: { status: "LIVE", startedAt: now } }),
      this.prisma.classSession.update({ where: { id: slot.id }, data: { isLive: true, liveSince: slot.isLive ? slot.liveSince : now } }),
    ]);
    await this.audit.record(actor.userId, "ONLINE_CLASS_START", "OnlineClass", id, slot.title);
    return started;
  }

  async end(actor: Actor, id: number, recordingUrl: string | null) {
    const { row, slot } = await this.owned(actor, id);
    if (row.status !== "LIVE") throw conflict("Only a live class can be ended.");
    const now = new Date();
    const otherLive = await this.prisma.onlineClass.count({ where: { classSessionId: slot.id, status: "LIVE", NOT: { id } } });
    const [ended] = await this.prisma.$transaction([
      this.prisma.onlineClass.update({ where: { id }, data: { status: "ENDED", endedAt: now, ...(recordingUrl ? { recordingUrl } : {}) } }),
      ...(otherLive === 0 ? [this.prisma.classSession.update({ where: { id: slot.id }, data: { isLive: false, liveSince: null } })] : []),
    ]);
    await this.audit.record(actor.userId, "ONLINE_CLASS_END", "OnlineClass", id, slot.title);
    return ended;
  }

  /** Cancel a meeting that has not started, and tell its students. */
  async cancel(actor: Actor, id: number, reason: string | null) {
    const { row, slot } = await this.owned(actor, id);
    if (row.status !== "SCHEDULED") throw conflict("Only a class that has not started can be cancelled.");
    const students = await slotStudentIds(this.prisma, slot);
    const when = row.startsAt.toLocaleString("en-GB", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
    await this.prisma.$transaction([
      this.prisma.onlineClass.update({ where: { id }, data: { status: "CANCELLED" } }),
      this.prisma.notification.createMany({
        data: students.map((userId) => ({
          userId, kind: "REMINDER", title: `Class cancelled: ${slot.title}`,
          body: `The online class on ${when} (Korea time) is cancelled.${reason ? ` ${reason}` : ""}`,
          link: "/classroom/routine",
        })),
      }),
    ]);
    await this.audit.record(actor.userId, "ONLINE_CLASS_CANCEL", "OnlineClass", id, slot.title);
    return { id, status: "CANCELLED", notified: students.length };
  }

  /** Who of the class opened the link, and when; everyone else is listed as not joined. */
  async joins(actor: Actor, id: number) {
    const { row, slot } = await this.owned(actor, id);
    const [students, joins] = await Promise.all([
      slotStudentIds(this.prisma, slot),
      this.prisma.onlineClassJoin.findMany({ where: { onlineClassId: id }, select: { userId: true, joinedAt: true } }),
    ]);
    const people = await this.prisma.user.findMany({
      where: { id: { in: [...new Set([...students, ...joins.map((j) => j.userId)])] } },
      select: { id: true, name: true, role: true, studentProfile: { select: { studentId: true } } },
      orderBy: { name: "asc" },
    });
    const joinedAt = new Map(joins.map((j) => [j.userId, j.joinedAt]));
    return {
      onlineClass: { id: row.id, status: row.status, startsAt: row.startsAt, endsAt: row.endsAt },
      people: people.map((p) => ({ ...p, joinedAt: joinedAt.get(p.id) ?? null })),
    };
  }

  /* ----------------------------------------------------------------- student */

  /** The student's coming and live meetings, without links. */
  async upcoming(actor: Actor) {
    const semester = await currentTermCode(this.prisma, actor.instituteId);
    const now = new Date();
    const rows = await this.prisma.onlineClass.findMany({
      where: {
        classSession: studentSlotsWhere(actor, semester),
        status: { in: ["SCHEDULED", "LIVE", "CANCELLED"] },
        endsAt: { gte: now },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
      select: listFields,
    });
    return rows.map((r) => ({ ...r, canJoin: joinable(r, now) }));
  }

  /** Hand the student the link, if they belong and the meeting is open; log the first join. */
  async join(actor: Actor, id: number) {
    const semester = await currentTermCode(this.prisma, actor.instituteId);
    const row = await this.prisma.onlineClass.findFirst({
      where: { id, classSession: studentSlotsWhere(actor, semester) },
      include: { classSession: { select: { zoomLink: true } } },
    });
    if (!row) throw notFound("Online class");
    if (!joinable(row)) {
      throw unprocessable(row.status === "SCHEDULED" ? "This class opens 10 minutes before it starts." : `This class is ${row.status.toLowerCase()}.`);
    }
    const joinUrl = row.joinUrl ?? row.classSession.zoomLink;
    if (!joinUrl) throw unprocessable("Your teacher has not added a link for this class yet.");
    await this.prisma.onlineClassJoin.createMany({ data: [{ onlineClassId: id, userId: actor.userId }], skipDuplicates: true });
    return { joinUrl };
  }
}
