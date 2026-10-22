import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, forbidden, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import { schoolToday } from "../../common/constants";
import type { Actor } from "../../common/actor";
import { teacherProfileId } from "../structure/teaching-scope";
import { currentTermCode, studentSlotsWhere } from "../schedule/class-scope";
import { assertMove, daysInclusive, excusedMarks, LEAVE_FLOW } from "./workflow";
import type { LeaveInput } from "./application.schema";

const MAX_DAYS = 60;
const BACKDATE_DAYS = 30;
const fields = {
  id: true, fromDate: true, toDate: true, days: true, reason: true, attachmentUrl: true, status: true,
  recommendation: true, reviewedAt: true, reviewNote: true, decidedAt: true, decisionNote: true, excusedMarks: true, createdAt: true,
  student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } },
} as const;

/**
 * Student leave: Application -> Review -> Approval/Rejection -> Notification -> History.
 *
 *  - A student applies for whole days, at most 60, starting no more than 30 days back.
 *  - Their class teacher reviews it and recommends. When the institute lets class teachers decide
 *    short leave alone (`leaveTeacherMaxDays`) and the leave is that short, the review decides it.
 *  - Otherwise the Head Master (`leave:decide`) approves or rejects, reviewed or not.
 *  - Approval marks every class of the student on those days EXCUSED, in the same transaction.
 *  - The student is told at each step and may cancel until it is decided.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async notifyHeads(instituteId: number, title: string, body: string) {
    const heads = await this.prisma.user.findMany({ where: { instituteId, role: "HEAD_MASTER", active: true }, select: { id: true } });
    if (heads.length) await this.prisma.notification.createMany({ data: heads.map((h) => ({ userId: h.id, kind: "ADMIN", title, body, link: "/admin/leave" })) });
  }

  private notifyStudent(userId: number, title: string, body: string) {
    return this.prisma.notification.create({ data: { userId, kind: "GENERAL", title, body, link: "/classroom/documents" } });
  }

  /* ----------------------------------------------------------------- student */

  async apply(actor: Actor, input: LeaveInput) {
    const days = daysInclusive(input.fromDate, input.toDate);
    if (days > MAX_DAYS) throw unprocessable(`Apply for at most ${MAX_DAYS} days at a time.`);
    const earliest = new Date(new Date(`${schoolToday()}T00:00:00Z`).getTime() - BACKDATE_DAYS * 86_400_000);
    if (input.fromDate < earliest) throw unprocessable(`Leave can start at most ${BACKDATE_DAYS} days ago.`);
    const overlap = await this.prisma.leaveApplication.findFirst({
      where: { studentUserId: actor.userId, status: { in: ["PENDING", "REVIEWED", "APPROVED"] }, fromDate: { lte: input.toDate }, toDate: { gte: input.fromDate } },
      select: { id: true },
    });
    if (overlap) throw conflict("You already have leave for some of these days.");

    // The section whose class teacher reviews: the regular class first, else any current section.
    const places = await this.prisma.sectionEnrollment.findMany({
      where: { studentUserId: actor.userId, status: "ACTIVE", batch: { term: { ...inInstitute(actor), isCurrent: true } } },
      select: { sectionId: true, section: { select: { classTeacher: { select: { userId: true } } } }, batch: { select: { courseLevel: { select: { course: { select: { type: true } } } } } } },
    });
    const place = places.find((p) => p.batch.courseLevel.course.type === "REGULAR") ?? places[0];

    const row = await this.prisma.leaveApplication.create({
      data: { ...inInstitute(actor), studentUserId: actor.userId, sectionId: place?.sectionId ?? null, ...input, days },
      select: fields,
    });
    const teacherUserId = place?.section.classTeacher?.userId;
    const summary = `${actor.name}: ${days} day${days === 1 ? "" : "s"} from ${input.fromDate.toISOString().slice(0, 10)}`;
    if (teacherUserId) {
      await this.prisma.notification.create({ data: { userId: teacherUserId, kind: "ADMIN", title: "Leave request to review", body: summary, link: "/office/leave" } });
    } else {
      await this.notifyHeads(actor.instituteId, "Leave request", summary);
    }
    return row;
  }

  mine(actor: Actor) {
    return this.prisma.leaveApplication.findMany({ where: { studentUserId: actor.userId }, orderBy: { fromDate: "desc" }, select: fields });
  }

  async cancel(actor: Actor, id: number) {
    const row = await this.prisma.leaveApplication.findFirst({ where: { id, studentUserId: actor.userId } });
    if (!row) throw notFound("Leave request");
    assertMove(LEAVE_FLOW, row.status, "CANCELLED", "leave request");
    return this.prisma.leaveApplication.update({ where: { id }, data: { status: "CANCELLED" }, select: fields });
  }

  /* ----------------------------------------------------------------- class teacher */

  /** Leave of the sections this teacher is class teacher of; waiting ones first. */
  async teacherQueue(actor: Actor, status?: string) {
    const profileId = await teacherProfileId(this.prisma, actor);
    return this.prisma.leaveApplication.findMany({
      where: { ...inInstitute(actor), sectionId: { not: null }, ...(status ? { status } : {}), AND: [{ sectionId: { in: await this.ledSections(profileId) } }] },
      orderBy: [{ status: "asc" }, { fromDate: "desc" }],
      take: 200,
      select: fields,
    });
  }

  private async ledSections(profileId: number) {
    return (await this.prisma.section.findMany({ where: { classTeacherId: profileId }, select: { id: true } })).map((s) => s.id);
  }

  /**
   * The class teacher's review. Short leave (within the institute's limit) is decided here;
   * anything longer goes on to the Head Master with the recommendation.
   */
  async review(actor: Actor, id: number, recommendation: "APPROVE" | "REJECT", note: string | null) {
    const row = await this.prisma.leaveApplication.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Leave request");
    const profileId = await teacherProfileId(this.prisma, actor);
    if (row.sectionId == null || !(await this.ledSections(profileId)).includes(row.sectionId)) {
      throw forbidden("Only the student's class teacher can review this.");
    }
    if (row.status !== "PENDING") assertMove(LEAVE_FLOW, row.status, "REVIEWED", "leave request");
    const institute = await this.prisma.institute.findUniqueOrThrow({ where: { id: actor.instituteId }, select: { leaveTeacherMaxDays: true } });
    const decidesAlone = institute.leaveTeacherMaxDays > 0 && row.days <= institute.leaveTeacherMaxDays;
    const reviewed = { recommendation, reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: note };

    if (decidesAlone) {
      const decided = await this.decideInternal(actor, row, recommendation, note, reviewed);
      await this.audit.record(actor.userId, recommendation === "APPROVE" ? "LEAVE_APPROVE" : "LEAVE_REJECT", "LeaveApplication", id, `by class teacher (${row.days} days)`);
      return decided;
    }
    assertMove(LEAVE_FLOW, row.status, "REVIEWED", "leave request");
    const updated = await this.prisma.leaveApplication.update({ where: { id }, data: { status: "REVIEWED", ...reviewed }, select: fields });
    await this.notifyHeads(actor.instituteId, "Leave request reviewed", `${updated.student.name}: class teacher recommends ${recommendation === "APPROVE" ? "approval" : "rejection"}`);
    await this.audit.record(actor.userId, "LEAVE_REVIEW", "LeaveApplication", id, recommendation);
    return updated;
  }

  /* ----------------------------------------------------------------- Head Master */

  manageList(actor: Actor, status?: string) {
    return this.prisma.leaveApplication.findMany({
      where: { ...inInstitute(actor), ...(status ? { status } : {}) },
      orderBy: [{ status: "asc" }, { fromDate: "desc" }],
      take: 300,
      select: { ...fields, sectionId: true },
    });
  }

  async decide(actor: Actor, id: number, decision: "APPROVE" | "REJECT", note: string | null, ip?: string) {
    const row = await this.prisma.leaveApplication.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Leave request");
    const decided = await this.decideInternal(actor, row, decision, note, {});
    await this.audit.record(actor.userId, decision === "APPROVE" ? "LEAVE_APPROVE" : "LEAVE_REJECT", "LeaveApplication", id, note ?? undefined, {
      ip, diff: { before: { status: row.status }, after: { status: decided.status } },
    });
    return decided;
  }

  /** Decide, and on approval excuse the student's classes on those days - one transaction. */
  private async decideInternal(
    actor: Actor,
    row: { id: number; status: string; studentUserId: number; fromDate: Date; toDate: Date; days: number },
    decision: "APPROVE" | "REJECT",
    note: string | null,
    extra: Prisma.LeaveApplicationUpdateInput,
  ) {
    const to = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    assertMove(LEAVE_FLOW, row.status, to, "leave request");
    const base = { status: to, decidedById: actor.userId, decidedAt: new Date(), decisionNote: note, ...extra };

    let marks: { classSessionId: number; date: Date }[] = [];
    if (to === "APPROVED") {
      const semester = await currentTermCode(this.prisma, actor.instituteId);
      const studentActor = { ...actor, userId: row.studentUserId, role: "STUDENT" as const };
      const slots = await this.prisma.classSession.findMany({ where: studentSlotsWhere(studentActor, semester), select: { id: true, dayOfWeek: true } });
      marks = excusedMarks(slots, row.fromDate, row.toDate);
    }
    const remark = `Leave #${row.id}`;
    const [updated] = await this.prisma.$transaction([
      this.prisma.leaveApplication.update({ where: { id: row.id }, data: { ...base, excusedMarks: marks.length }, select: fields }),
      ...marks.map((m) => this.prisma.attendance.upsert({
        where: { classSessionId_studentUserId_date: { classSessionId: m.classSessionId, studentUserId: row.studentUserId, date: m.date } },
        create: { classSessionId: m.classSessionId, studentUserId: row.studentUserId, date: m.date, status: "EXCUSED", remark, markedById: actor.userId },
        update: { status: "EXCUSED", remark, markedById: actor.userId },
      })),
    ]);
    await this.notifyStudent(row.studentUserId, to === "APPROVED" ? "Leave approved" : "Leave not approved",
      `${row.days} day${row.days === 1 ? "" : "s"} from ${row.fromDate.toISOString().slice(0, 10)}${note ? `: ${note}` : ""}`);
    return updated;
  }

  async setTeacherMaxDays(actor: Actor, days: number, ip?: string) {
    const before = await this.prisma.institute.findUniqueOrThrow({ where: { id: actor.instituteId }, select: { leaveTeacherMaxDays: true } });
    await this.prisma.institute.update({ where: { id: actor.instituteId }, data: { leaveTeacherMaxDays: days } });
    await this.audit.record(actor.userId, "LEAVE_SETTINGS", "Institute", actor.instituteId, undefined, { ip, diff: { before, after: { leaveTeacherMaxDays: days } } });
    return { leaveTeacherMaxDays: days };
  }
}
