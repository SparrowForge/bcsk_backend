import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { forbidden, notFound, unprocessable } from "../../common/errors/app-error";
import { SEMESTER_CURRENT, schoolToday } from "../../common/constants";
import type { Actor } from "../../common/actor";
import { assertTeaches, teacherProfileId } from "../structure/teaching-scope";
import { assertOwnsSlot, slotRoster, slotStudentIds } from "../schedule/class-scope";

/** Attendance values are validated server-side, never trusted from a form. */
const VALID_ATTENDANCE = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];

/** A teacher sets only these two about themselves; IN_CLASS is derived, never stored. */
const VALID_DESK_STATUS = ["DESK", "OFFLINE"];

/**
 * The teacher surface.
 *
 * `ownSession` is the load-bearing check and the pattern the rest of the codebase copies:
 * a class session id arriving from a client is a claim, so ownership is re-derived from the
 * database on every operation rather than trusted.
 */
@Injectable()
export class OfficeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A class is the teacher's when it names them, or (LMS B1) when it teaches a section and
   * subject they are assigned to - so reassigning a subject moves the class with it. The rule
   * lives in `class-scope.ts`, shared with the online classes.
   */
  private ownSession(actor: Actor, classSessionId: number) {
    return assertOwnsSlot(this.prisma, actor, classSessionId);
  }

  /**
   * LMS B1: the sections this teacher works in this term - those they teach a subject in, and
   * those they are class teacher of - with their own subjects in each.
   */
  async mySections(actor: Actor) {
    const profileId = await teacherProfileId(this.prisma, actor);
    const sections = await this.prisma.section.findMany({
      where: {
        active: true,
        batch: { term: { instituteId: actor.instituteId, isCurrent: true } },
        OR: [{ classTeacherId: profileId }, { assignments: { some: { teacherProfileId: profileId } } }],
      },
      orderBy: [{ batchId: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, room: true, classTeacherId: true,
        batch: { select: { id: true, name: true, term: { select: { code: true, name: true } }, courseLevel: { select: { id: true, name: true } } } },
        assignments: { where: { teacherProfileId: profileId }, select: { subject: { select: { id: true, code: true, name: true } } } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
    });
    return sections.map(({ classTeacherId, assignments, ...s }) => ({
      ...s,
      isClassTeacher: classTeacherId === profileId,
      subjects: assignments.map((a) => a.subject),
    }));
  }

  /** The students of one of the teacher's sections. Names and roll numbers only - no family data. */
  async sectionRoster(actor: Actor, sectionId: number) {
    const scope = await assertTeaches(this.prisma, actor, sectionId);
    const students = await this.prisma.sectionEnrollment.findMany({
      where: { sectionId, status: "ACTIVE" },
      orderBy: [{ rollNo: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      select: { rollNo: true, student: { select: { id: true, name: true, studentProfile: { select: { studentId: true, photoUrl: true } } } } },
    });
    return { sectionId, isClassTeacher: scope.isClassTeacher, students };
  }

  async dashboard(actor: Actor) {
    const profile = await this.prisma.teacherProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) throw notFound("Teacher profile");
    const [sessions, notifications, openQuestions] = await Promise.all([
      this.prisma.classSession.findMany({
        where: { teacherId: profile.id, semester: SEMESTER_CURRENT, active: true },
        include: { _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
        orderBy: { id: "asc" },
      }),
      this.prisma.notification.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      // `answeredAt` rather than `answer`: both are written together by answerQuestion, but
      // only this one matches @@index([teacherUserId, answeredAt]) and the admin dashboard.
      this.prisma.question.count({ where: { teacherUserId: actor.userId, answeredAt: null } }),
    ]);
    return { profile, sessions, notifications, openQuestions };
  }

  /**
   * Guardian contacts for every student this teacher currently teaches.
   *
   * Scoped to their own classes: a teacher may reach the families they teach and no others.
   */
  async guardians(actor: Actor) {
    const profile = await this.prisma.teacherProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) throw notFound("Teacher profile");
    const sessions = await this.prisma.classSession.findMany({
      where: { teacherId: profile.id, semester: SEMESTER_CURRENT },
      include: {
        enrollments: {
          where: { status: "ACTIVE" },
          include: { student: { include: { studentProfile: true } } },
        },
      },
    });
    return sessions;
  }

  async myClasses(actor: Actor) {
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { userId: actor.userId } });
    if (!teacher) throw notFound("Teacher profile");
    return this.prisma.classSession.findMany({
      where: { teacherId: teacher.id, active: true },
      // Same ACTIVE-only rule as the dashboard, which otherwise reports a smaller number
      // than this page for the very same class.
      include: {
        course: true,
        level: true,
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { id: "asc" },
    });
  }

  async classDetail(actor: Actor, classSessionId: number) {
    const cs = await this.ownSession(actor, classSessionId);
    // Attendance rows are keyed by the school's calendar day (Korea). Taking "today" from the UTC
    // date showed the previous day's sheet between 00:00 and 09:00 KST.
    const todayUtc = new Date(`${schoolToday()}T00:00:00Z`);
    const [roster, assignments, videos, todayAttendance] = await Promise.all([
      this.roster(cs),
      this.prisma.assignment.findMany({
        where: { classSessionId: cs.id },
        include: {
          submissions: { include: { student: { select: { id: true, name: true, studentProfile: true } } } },
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.classVideo.findMany({ where: { classSessionId: cs.id }, orderBy: { recordedAt: "desc" } }),
      // Prefills the attendance sheet so a teacher sees what they already marked today.
      this.prisma.attendance.findMany({ where: { classSessionId: cs.id, date: todayUtc } }),
    ]);
    return { classSession: cs, roster, assignments, videos, todayAttendance };
  }

  /**
   * `liveSince` is stamped here and nowhere else, so the homepage's "duration" is the time
   * since a teacher actually started the class rather than the scheduled start. Re-pressing
   * "go live" on a class that is already live must not restart that clock, which is why the
   * timestamp is only written on the transition.
   */
  async toggleLive(actor: Actor, classSessionId: number, live: boolean, zoomLink?: string) {
    const cs = await this.ownSession(actor, classSessionId);
    const liveSince = live ? (cs.isLive ? cs.liveSince : new Date()) : null;
    return this.prisma.classSession.update({
      where: { id: cs.id },
      data: { isLive: live, liveSince, ...(zoomLink ? { zoomLink } : {}) },
    });
  }

  /**
   * The teacher's own desk presence, shown on the homepage office board.
   *
   * A teacher may only set DESK or OFFLINE about themselves. "In class" is not settable and
   * is not stored: the board derives it from owning a live session, so the two boards cannot
   * disagree and a teacher cannot claim to be teaching a class they have not started.
   */
  async setDeskStatus(actor: Actor, status: string, returnAt: string | null) {
    const profile = await this.prisma.teacherProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) throw notFound("Teacher profile");
    if (!VALID_DESK_STATUS.includes(status)) throw unprocessable("Choose a valid desk status.");

    let back: Date | null = null;
    if (returnAt) {
      back = new Date(returnAt);
      if (Number.isNaN(back.getTime())) throw unprocessable("Enter a valid return time.");
      // A return time in the past would render as "back in 0 min" for ever.
      if (back.getTime() < Date.now()) throw unprocessable("A return time must be in the future.");
    }
    return this.prisma.teacherProfile.update({
      where: { id: profile.id },
      // Sitting back down clears the return time; leaving it behind would show a stale
      // "back in 20 min" beside a teacher who is already at their desk.
      data: { deskStatus: status, returnAt: status === "DESK" ? null : back },
    });
  }

  /**
   * The class roster in the shape the class page has always read (an enrolment row with its
   * student). LMS B3: it now includes the students placed through the section, not only those
   * enrolled in the slot directly; a section-only student's row has `id` 0.
   */
  private async roster(cs: { id: number; sectionId: number | null; semester: string }) {
    const rows = await slotRoster(this.prisma, cs);
    return rows.map((r) => ({
      id: 0, studentUserId: r.student.id, classSessionId: cs.id, semester: cs.semester, status: "ACTIVE", rollNo: r.rollNo, student: r.student,
    }));
  }

  /** LMS B3: the attendance sheet for any day - the roster with what is already marked. */
  async attendanceSheet(actor: Actor, classSessionId: number, dateStr: string) {
    const cs = await this.ownSession(actor, classSessionId);
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) throw unprocessable("Enter a valid date.");
    const [roster, marked] = await Promise.all([
      slotRoster(this.prisma, cs),
      this.prisma.attendance.findMany({ where: { classSessionId: cs.id, date }, select: { studentUserId: true, status: true, remark: true } }),
    ]);
    const byStudent = new Map(marked.map((m) => [m.studentUserId, m]));
    return {
      classSessionId: cs.id,
      date: dateStr,
      students: roster.map((r) => ({
        ...r,
        status: byStudent.get(r.student.id)?.status ?? null,
        remark: byStudent.get(r.student.id)?.remark ?? null,
      })),
    };
  }

  /**
   * PERF-3: one transaction rather than a round-trip per student. LMS B3: only the class's own
   * students are written - a student id from outside it is dropped, not recorded - and every
   * row records who marked it. A day in the future is refused.
   */
  async markAttendance(
    actor: Actor,
    classSessionId: number,
    dateStr: string,
    entries: { studentUserId: number; status: string; remark?: string | null }[],
  ) {
    const cs = await this.ownSession(actor, classSessionId);
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) throw unprocessable("Enter a valid date.");
    if (dateStr > schoolToday()) throw unprocessable("Attendance cannot be marked for a day that has not come yet.");

    const members = new Set(await slotStudentIds(this.prisma, cs));
    const clean = entries.filter(
      (e) => Number.isInteger(e.studentUserId) && VALID_ATTENDANCE.includes(e.status) && members.has(e.studentUserId),
    );
    const skipped = entries.length - clean.length;
    if (clean.length === 0) return { updated: 0, skipped };

    await this.prisma.$transaction(
      clean.map((e) => {
        const values = { status: e.status, remark: e.remark?.trim() || null, markedById: actor.userId };
        return this.prisma.attendance.upsert({
          where: { classSessionId_studentUserId_date: { classSessionId: cs.id, studentUserId: e.studentUserId, date } },
          update: values,
          create: { classSessionId: cs.id, studentUserId: e.studentUserId, date, ...values },
        });
      }),
    );
    return { updated: clean.length, skipped };
  }

  async postAssignment(
    actor: Actor,
    classSessionId: number,
    input: { title: string; description?: string; dueDate?: string; filePath?: string; maxMarks?: number | null },
  ) {
    const cs = await this.ownSession(actor, classSessionId);
    const assignment = await this.prisma.assignment.create({
      data: {
        classSessionId: cs.id,
        title: input.title,
        description: input.description || null,
        fileUrl: input.filePath || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        maxMarks: input.maxMarks ?? null,
        createdById: actor.userId,
      },
    });
    // LMS B3: everyone in the class - section-placed students too, not only direct enrolments.
    const students = await slotStudentIds(this.prisma, cs);
    await this.prisma.notification.createMany({
      data: students.map((userId) => ({
        userId,
        title: `New assignment: ${input.title}`,
        body: cs.title,
        kind: "ASSIGNMENT",
        link: "/classroom/assignments",
      })),
    });
    return assignment;
  }

  /** An assignment of one of the teacher's classes, or refuse. */
  private async ownAssignment(actor: Actor, assignmentId: number) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw notFound("Assignment");
    await this.ownSession(actor, assignment.classSessionId);
    return assignment;
  }

  /** LMS B3: correct an assignment. Lowering the marks below a grade already given is refused. */
  async updateAssignment(
    actor: Actor,
    assignmentId: number,
    input: { title: string; description?: string; dueDate?: string; filePath?: string; maxMarks?: number | null },
  ) {
    await this.ownAssignment(actor, assignmentId);
    if (input.maxMarks != null) {
      const top = await this.prisma.submission.aggregate({ where: { assignmentId }, _max: { marks: true } });
      if ((top._max.marks ?? 0) > input.maxMarks) {
        throw unprocessable(`A student already has ${top._max.marks} marks; the maximum cannot go below that.`);
      }
    }
    return this.prisma.assignment.update({
      where: { id: assignmentId },
      data: {
        title: input.title,
        description: input.description || null,
        fileUrl: input.filePath || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        maxMarks: input.maxMarks ?? null,
      },
    });
  }

  /** LMS B3: remove an assignment nobody has handed in yet. Submitted work is never deleted. */
  async deleteAssignment(actor: Actor, assignmentId: number) {
    await this.ownAssignment(actor, assignmentId);
    if ((await this.prisma.submission.count({ where: { assignmentId } })) > 0) {
      throw unprocessable("Students have already handed this in, so it can't be deleted. Edit it instead.");
    }
    await this.prisma.assignment.delete({ where: { id: assignmentId } });
    return { id: assignmentId };
  }

  /**
   * Grade a submission: a grade or comment, numeric marks (out of the assignment's maximum),
   * or both. Ownership is re-derived from the submission's class, by the same rule as every
   * other class action - an assigned teacher may grade, not only the one the slot names.
   */
  async gradeSubmission(actor: Actor, submissionId: number, input: { grade?: string | null; marks?: number | null; feedback?: string | null }) {
    const sub = await this.prisma.submission.findUnique({ where: { id: submissionId }, include: { assignment: true } });
    if (!sub) throw forbidden("That is not your class.");
    await this.ownSession(actor, sub.assignment.classSessionId);
    const grade = input.grade?.trim() || null;
    const marks = input.marks ?? null;
    if (!grade && marks == null) throw unprocessable("Give a grade, marks, or both.");
    if (marks != null) {
      if (sub.assignment.maxMarks == null) throw unprocessable("This assignment has no maximum marks; give a grade instead.");
      if (marks < 0 || marks > sub.assignment.maxMarks) throw unprocessable(`Marks must be between 0 and ${sub.assignment.maxMarks}.`);
    }
    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { grade, marks, feedback: input.feedback || null, gradedAt: new Date() },
    });
    const shown = [marks != null ? `${marks}/${sub.assignment.maxMarks}` : null, grade].filter(Boolean).join(" · ");
    await this.prisma.notification.create({
      data: {
        userId: sub.studentUserId,
        title: `Graded: ${sub.assignment.title}`,
        body: shown,
        kind: "ASSIGNMENT",
        link: "/classroom/assignments",
      },
    });
    return updated;
  }

  async addVideo(actor: Actor, classSessionId: number, title: string, videoUrl: string) {
    const cs = await this.ownSession(actor, classSessionId);
    try {
      const u = new URL(videoUrl);
      if (!["http:", "https:"].includes(u.protocol)) throw new Error();
    } catch {
      throw unprocessable("The video link must be a valid http(s) URL.");
    }
    return this.prisma.classVideo.create({ data: { classSessionId: cs.id, title, videoUrl } });
  }

  async questions(actor: Actor) {
    return this.prisma.question.findMany({
      where: { teacherUserId: actor.userId },
      include: { student: { select: { id: true, name: true, studentProfile: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async answerQuestion(actor: Actor, questionId: number, answer: string) {
    const q = await this.prisma.question.findUnique({ where: { id: questionId } });
    if (!q || q.teacherUserId !== actor.userId) throw forbidden("That is not your question.");
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: { answer, answeredAt: new Date() },
    });
    await this.prisma.notification.create({
      data: {
        userId: q.studentUserId,
        title: "Your teacher replied",
        body: q.subject,
        kind: "QUESTION",
        link: "/classroom/ask-teacher",
      },
    });
    return updated;
  }

  async tasks(actor: Actor) {
    return this.prisma.teacherTask.findMany({
      where: { teacherUserId: actor.userId },
      orderBy: [{ done: "asc" }, { id: "desc" }],
    });
  }

  async toggleTask(actor: Actor, taskId: number, done: boolean) {
    const task = await this.prisma.teacherTask.findUnique({ where: { id: taskId } });
    if (!task || task.teacherUserId !== actor.userId) throw forbidden();
    return this.prisma.teacherTask.update({ where: { id: taskId }, data: { done } });
  }
}
