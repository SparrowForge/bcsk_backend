import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { forbidden, notFound, unprocessable } from "@/common/errors/app-error";
import { SEMESTER_CURRENT } from "@/common/constants";
import type { Actor } from "@/common/actor";

/** Attendance values are validated server-side, never trusted from a form. */
const VALID_ATTENDANCE = ["PRESENT", "ABSENT", "LATE"];

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

  private async ownSession(actor: Actor, classSessionId: number) {
    const cs = await this.prisma.classSession.findUnique({
      where: { id: classSessionId },
      include: { teacher: true },
    });
    if (!cs) throw notFound("Class");
    if (cs.teacher?.userId !== actor.userId) throw forbidden("That is not your class.");
    return cs;
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
    const today = new Date();
    const todayUtc = new Date(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
    const [roster, assignments, videos, todayAttendance] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: { classSessionId: cs.id, status: "ACTIVE" },
        include: { student: { include: { studentProfile: true } } },
      }),
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

  async toggleLive(actor: Actor, classSessionId: number, live: boolean, zoomLink?: string) {
    const cs = await this.ownSession(actor, classSessionId);
    return this.prisma.classSession.update({
      where: { id: cs.id },
      data: { isLive: live, ...(zoomLink ? { zoomLink } : {}) },
    });
  }

  /** PERF-3: one transaction rather than a round-trip per student. */
  async markAttendance(actor: Actor, classSessionId: number, dateStr: string, entries: { studentUserId: number; status: string }[]) {
    const cs = await this.ownSession(actor, classSessionId);
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) throw unprocessable("Enter a valid date.");

    const clean = entries.filter(
      (e) => Number.isInteger(e.studentUserId) && VALID_ATTENDANCE.includes(e.status),
    );
    if (clean.length === 0) return { updated: 0 };

    await this.prisma.$transaction(
      clean.map((e) =>
        this.prisma.attendance.upsert({
          where: {
            classSessionId_studentUserId_date: {
              classSessionId: cs.id,
              studentUserId: e.studentUserId,
              date,
            },
          },
          update: { status: e.status },
          create: { classSessionId: cs.id, studentUserId: e.studentUserId, date, status: e.status },
        }),
      ),
    );
    return { updated: clean.length };
  }

  async postAssignment(actor: Actor, classSessionId: number, input: { title: string; description?: string; dueDate?: string; filePath?: string }) {
    const cs = await this.ownSession(actor, classSessionId);
    const assignment = await this.prisma.assignment.create({
      data: {
        classSessionId: cs.id,
        title: input.title,
        description: input.description || null,
        fileUrl: input.filePath || null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
      },
    });
    const enrolled = await this.prisma.enrollment.findMany({
      where: { classSessionId: cs.id, status: "ACTIVE" },
    });
    await this.prisma.notification.createMany({
      data: enrolled.map((e) => ({
        userId: e.studentUserId,
        title: `New assignment: ${input.title}`,
        body: cs.title,
        kind: "ASSIGNMENT",
        link: "/classroom/assignments",
      })),
    });
    return assignment;
  }

  async gradeSubmission(actor: Actor, submissionId: number, grade: string, feedback?: string) {
    const sub = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: { include: { classSession: { include: { teacher: true } } } } },
    });
    // Ownership is re-derived independently rather than inherited from the caller.
    if (!sub || sub.assignment.classSession.teacher?.userId !== actor.userId) {
      throw forbidden("That is not your class.");
    }
    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { grade, feedback: feedback || null, gradedAt: new Date() },
    });
    await this.prisma.notification.create({
      data: {
        userId: sub.studentUserId,
        title: `Graded: ${sub.assignment.title}`,
        body: `Grade ${grade}`,
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
