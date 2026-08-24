import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { SEMESTER_CURRENT } from "@/common/constants";
import { conflict, forbidden, notFound, unprocessable } from "@/common/errors/app-error";
import { randomBytes } from "node:crypto";
import type { Actor, MaybeActor } from "@/common/actor";

/**
 * The student surface. Every query is scoped to the calling actor's own id — a student can
 * only ever read their own record, and that scoping happens here rather than in a
 * controller, so no caller can forget it.
 */
@Injectable()
export class ClassroomService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(actor: Actor) {
    const [profile, enrollments, notifications] = await Promise.all([
      this.prisma.studentProfile.findUnique({ where: { userId: actor.userId } }),
      this.prisma.enrollment.findMany({
        where: { studentUserId: actor.userId, semester: SEMESTER_CURRENT, status: "ACTIVE" },
        include: { classSession: { include: { course: true, teacher: { include: { user: true } }, level: true } } },
        orderBy: { id: "asc" },
      }),
      this.prisma.notification.findMany({
        where: { userId: actor.userId },
        orderBy: { createdAt: "desc" },
        take: 6,
      }),
    ]);
    return { profile, enrollments, notifications, semester: SEMESTER_CURRENT };
  }

  async assignments(actor: Actor) {
    const enrolled = await this.prisma.enrollment.findMany({
      where: { studentUserId: actor.userId, status: "ACTIVE" },
      select: { classSessionId: true },
    });
    const ids = enrolled.map((e) => e.classSessionId);
    return this.prisma.assignment.findMany({
      where: { classSessionId: { in: ids } },
      include: {
        classSession: { select: { title: true } },
        submissions: { where: { studentUserId: actor.userId } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async submitAssignment(actor: Actor, assignmentId: number, text: string | null, filePath: string | null) {
    const assignment = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw notFound("Assignment");

    // Enrolment is the authorisation: a student may only submit to their own class.
    const enrolled = await this.prisma.enrollment.findFirst({
      where: { studentUserId: actor.userId, classSessionId: assignment.classSessionId, status: "ACTIVE" },
    });
    if (!enrolled) throw forbidden("You are not enrolled in this class.");
    if (!text && !filePath) throw unprocessable("Attach a file or write your answer before submitting.");

    return this.prisma.submission.upsert({
      where: { assignmentId_studentUserId: { assignmentId, studentUserId: actor.userId } },
      update: { fileUrl: filePath, text, submittedAt: new Date() },
      create: { assignmentId, studentUserId: actor.userId, fileUrl: filePath, text },
    });
  }

  async results(actor: Actor) {
    const [exams, progress, hifz, games] = await Promise.all([
      this.prisma.examResult.findMany({ where: { studentUserId: actor.userId }, orderBy: { subject: "asc" } }),
      this.prisma.progressRecord.findMany({ where: { studentUserId: actor.userId }, orderBy: { recordedAt: "desc" } }),
      this.prisma.hifzProgress.findMany({ where: { studentUserId: actor.userId }, orderBy: { surahNumber: "asc" } }),
      this.prisma.gameScore.findMany({ where: { studentUserId: actor.userId }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return { exams, progress, hifz, games };
  }

  async attendance(actor: Actor) {
    return this.prisma.attendance.findMany({
      where: { studentUserId: actor.userId },
      include: { classSession: { select: { title: true } } },
      orderBy: { date: "desc" },
    });
  }

  async routine(actor: Actor) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentUserId: actor.userId, semester: SEMESTER_CURRENT, status: "ACTIVE" },
      include: { classSession: { include: { teacher: { include: { user: true } } } } },
    });
    return enrollments.map((e) => e.classSession);
  }

  async videos(actor: Actor) {
    const enrolled = await this.prisma.enrollment.findMany({
      where: { studentUserId: actor.userId, status: "ACTIVE" },
      select: { classSessionId: true },
    });
    return this.prisma.classVideo.findMany({
      where: { classSessionId: { in: enrolled.map((e) => e.classSessionId) } },
      include: { classSession: { select: { title: true } } },
      orderBy: { recordedAt: "desc" },
    });
  }

  /** Teachers a student may direct a question to. */
  async teacherDirectory() {
    const teachers = await this.prisma.teacherProfile.findMany({
      include: { user: { select: { id: true, name: true } } },
      orderBy: { displayOrder: "asc" },
    });
    return teachers.map((t) => ({
      userId: t.user.id,
      name: t.user.name,
      designation: t.designation,
      subjects: t.subjects,
    }));
  }

  /** Syllabus: the levels attached to whatever this student is enrolled in. */
  async syllabus(actor: Actor) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentUserId: actor.userId, semester: SEMESTER_CURRENT, status: "ACTIVE" },
      include: { classSession: { include: { course: true, level: true } } },
    });
    return enrollments.map((e) => ({
      classSessionId: e.classSessionId,
      title: e.classSession.title,
      courseName: e.classSession.course.name,
      levelName: e.classSession.level?.name ?? null,
      syllabus: e.classSession.level?.syllabus ?? null,
      studentBookUrl: e.classSession.level?.studentBookUrl ?? null,
      workBookUrl: e.classSession.level?.workBookUrl ?? null,
    }));
  }

  /** What re-admission would cost this student, and whether one is already pending. */
  async reAdmissionInfo(actor: Actor) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId: actor.userId } });
    if (!profile) throw notFound("Student profile");
    const fee = await this.prisma.feeConfig.findUnique({
      where: { key: profile.classLevel.toLowerCase() },
    });
    // The page renders the existing payment's status and reference, so return the row
    // rather than a boolean.
    const existing = await this.prisma.payment.findFirst({
      where: {
        payerUserId: actor.userId,
        purpose: "RE_ADMISSION",
        status: { in: ["PENDING_VERIFICATION", "PAID", "VERIFIED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, amount: true, virtualRef: true },
    });
    return {
      classLevel: profile.classLevel,
      studentId: profile.studentId,
      semesterFee: fee?.semesterFee ?? null,
      existing,
      semester: SEMESTER_CURRENT,
    };
  }

  /**
   * FR-ADM-10: submit a re-admission bank transfer.
   *
   * The amount comes from FeeConfig, never from the client — same rule as admission (SEC-3).
   */
  async submitReAdmission(actor: Actor, receiptPath: string) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { userId: actor.userId },
      include: { user: true },
    });
    if (!profile) throw notFound("Student profile");
    const fee = await this.prisma.feeConfig.findUnique({
      where: { key: profile.classLevel.toLowerCase() },
    });
    if (!fee) throw unprocessable("No fee is configured for your class — please contact the office.");

    const existing = await this.prisma.payment.findFirst({
      where: { payerUserId: actor.userId, purpose: "RE_ADMISSION", status: "PENDING_VERIFICATION" },
    });
    if (existing) throw conflict("We already have a re-admission payment awaiting verification.");

    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const virtualRef = `BCSK-VR-${ymd}-${randomBytes(3).toString("hex").toUpperCase()}`;

    await this.prisma.payment.create({
      data: {
        payerUserId: actor.userId,
        purpose: "RE_ADMISSION",
        method: "BANK_TRANSFER",
        amount: fee.semesterFee,
        status: "PENDING_VERIFICATION",
        virtualRef,
        receiptUploadUrl: receiptPath,
      },
    });
    return { virtualRef, amount: fee.semesterFee };
  }

  async askTeacher(actor: Actor, teacherUserId: number, subject: string, body: string) {
    const question = await this.prisma.question.create({
      data: { studentUserId: actor.userId, teacherUserId, subject, body },
    });
    await this.prisma.notification.create({
      data: {
        userId: teacherUserId,
        title: `New question from ${actor.name}`,
        body: subject,
        kind: "QUESTION",
        link: "/office/questions",
      },
    });
    return question;
  }

  /**
   * Which course slugs this visitor is enrolled in.
   *
   * Public course pages call this to decide whether to show the BCSK-student price, so it
   * must answer for anonymous visitors too — an empty list rather than an error.
   */
  async enrolledCourseSlugs(actor: MaybeActor): Promise<string[]> {
    if (!actor || actor.role !== "STUDENT") return [];
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentUserId: actor.userId, semester: SEMESTER_CURRENT, status: "ACTIVE" },
      include: { classSession: { include: { course: true } } },
    });
    return [...new Set(enrollments.map((e) => e.classSession.course.slug))];
  }

  /** FR-ABC-08: a Fun Abacus score, recorded against the student's progress report. */
  async recordGameScore(actor: MaybeActor, game: string, level: number, score: number) {
    if (!actor || actor.role !== "STUDENT") return { recorded: false };
    await this.prisma.gameScore.create({
      data: { studentUserId: actor.userId, game, level, score },
    });
    return { recorded: true };
  }

  /** FR-IELTS-04/05: a practice-quiz result. */
  async recordPracticeScore(actor: MaybeActor, score: number, total: number) {
    if (!actor || actor.role !== "STUDENT") return { recorded: false };
    await this.prisma.progressRecord.create({
      data: {
        studentUserId: actor.userId,
        courseSlug: "ielts-for-kids",
        label: "Practice quiz (mixed skills)",
        score: `${score}/${total}`,
      },
    });
    return { recorded: true };
  }

  async questions(actor: Actor) {
    return this.prisma.question.findMany({
      where: { studentUserId: actor.userId },
      orderBy: { createdAt: "desc" },
    });
  }
}
