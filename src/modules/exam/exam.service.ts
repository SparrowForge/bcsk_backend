import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService, auditDiff } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import type { Actor } from "../../common/actor";
import { toMinutes } from "../schedule/schedule.schema";
import { GradingService } from "./grading.service";
import type { ExamInput, ExamUpdateInput, PaperInput, PaperUpdateInput } from "./exam.schema";

const paperFields = {
  id: true, courseLevelId: true, subjectId: true, date: true, startTime: true, endTime: true, room: true,
  fullMarks: true, passMarks: true, examinerId: true,
  courseLevel: { select: { id: true, name: true, course: { select: { name: true } } } },
  subject: { select: { id: true, code: true, name: true } },
  examiner: { select: { id: true, user: { select: { name: true } } } },
} as const;

type PaperSlot = { id?: number; courseLevelId: number; date: Date; startTime: string; endTime: string; room: string | null };
const overlap = (a: PaperSlot, b: PaperSlot) =>
  a.date.getTime() === b.date.getTime() && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
const roomKey = (r: string | null) => (r?.trim().toLowerCase() || null);

/**
 * Two papers clash when they overlap on the same day and either the same class sits both or they
 * share a room. Pure, so the rule is tested without a database.
 */
export function paperClash(candidate: PaperSlot, others: (PaperSlot & { label: string })[]): { kind: "class" | "room"; label: string } | null {
  for (const o of others) {
    if (o.id != null && o.id === candidate.id) continue;
    if (!overlap(candidate, o)) continue;
    if (o.courseLevelId === candidate.courseLevelId) return { kind: "class", label: o.label };
    if (roomKey(candidate.room) && roomKey(candidate.room) === roomKey(o.room)) return { kind: "room", label: o.label };
  }
  return null;
}

/**
 * Exams, as the Head Master (`exams:manage`) runs them: create an exam for a term, add one paper
 * per class and subject with its date and marks, publish the schedule (students and teachers see
 * it; an EXAM entry goes on the calendar), follow each section's marks, and reopen a submitted
 * mark sheet when a correction is needed - with a reason, audited. The Head Master never types
 * marks: the person who approves results does not also write them.
 */
@Injectable()
export class ExamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly grading: GradingService,
  ) {}

  private async exam(actor: Actor, id: number) {
    const row = await this.prisma.exam.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Exam");
    return row;
  }

  private async paper(actor: Actor, id: number) {
    const row = await this.prisma.examPaper.findFirst({ where: { id, exam: inInstitute(actor) }, include: { exam: true } });
    if (!row) throw notFound("Paper");
    return row;
  }

  list(actor: Actor, termId?: number) {
    return this.prisma.exam.findMany({
      where: { ...inInstitute(actor), ...(termId ? { termId } : {}) },
      orderBy: [{ termId: "desc" }, { id: "desc" }],
      include: {
        term: { select: { id: true, code: true } },
        gradingScheme: { select: { id: true, name: true } },
        _count: { select: { papers: true } },
      },
    });
  }

  /**
   * One exam in full: its papers, and for each paper every section that sits it with the state of
   * that section's mark sheet - the Head Master's view of who has handed in marks.
   */
  async detail(actor: Actor, id: number) {
    const exam = await this.prisma.exam.findFirst({
      where: { id, ...inInstitute(actor) },
      include: {
        term: { select: { id: true, code: true, name: true } },
        gradingScheme: { include: { bands: { orderBy: { minPercent: "desc" } } } },
        papers: { orderBy: [{ date: "asc" }, { startTime: "asc" }], select: { ...paperFields, sheets: { select: { sectionId: true, status: true, submittedAt: true } } } },
      },
    });
    if (!exam) throw notFound("Exam");
    const sections = await this.prisma.section.findMany({
      where: { active: true, batch: { termId: exam.termId, courseLevelId: { in: [...new Set(exam.papers.map((p) => p.courseLevelId))] } } },
      select: { id: true, name: true, batch: { select: { courseLevelId: true } }, _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } },
      orderBy: { name: "asc" },
    });
    return {
      ...exam,
      papers: exam.papers.map(({ sheets, ...p }) => ({
        ...p,
        sections: sections
          .filter((s) => s.batch.courseLevelId === p.courseLevelId)
          .map((s) => {
            const sheet = sheets.find((x) => x.sectionId === s.id);
            return { sectionId: s.id, section: s.name, students: s._count.enrollments, status: sheet?.status ?? "NOT_STARTED", submittedAt: sheet?.submittedAt ?? null };
          }),
      })),
    };
  }

  async create(actor: Actor, input: ExamInput, ip?: string) {
    const term = await this.prisma.academicTerm.findFirst({ where: { id: input.termId, ...inInstitute(actor) }, select: { id: true } });
    if (!term) throw notFound("Term");
    const gradingSchemeId = await this.grading.resolve(actor, input.gradingSchemeId);
    try {
      const row = await this.prisma.exam.create({ data: { ...input, gradingSchemeId, ...inInstitute(actor), createdById: actor.userId } });
      await this.audit.record(actor.userId, "EXAM_CREATE", "Exam", row.id, row.name, { ip });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict(`This term already has an exam called ${input.name}.`);
      throw e;
    }
  }

  async update(actor: Actor, id: number, input: ExamUpdateInput, ip?: string) {
    const before = await this.exam(actor, id);
    if (before.status === "CANCELLED") throw unprocessable("This exam is cancelled.");
    const gradingSchemeId = await this.grading.resolve(actor, input.gradingSchemeId);
    if (gradingSchemeId !== before.gradingSchemeId && (await this.prisma.mark.count({ where: { paper: { examId: id } } })) > 0) {
      throw unprocessable("Marks are already in, so the grading scheme can't change.");
    }
    const data = { ...input, gradingSchemeId };
    const row = await this.prisma.exam.update({ where: { id }, data });
    if (row.status === "SCHEDULED") await this.syncCalendar(actor, id);
    await this.audit.record(actor.userId, "EXAM_EDIT", "Exam", id, row.name, { ip, diff: auditDiff(before, data) });
    return row;
  }

  /** Only a draft nobody has marked. A scheduled exam is cancelled instead. */
  async remove(actor: Actor, id: number, ip?: string) {
    const exam = await this.exam(actor, id);
    if (exam.status !== "DRAFT") throw unprocessable("Only a draft exam can be deleted; cancel a scheduled one.");
    await this.prisma.exam.delete({ where: { id } });
    await this.audit.record(actor.userId, "EXAM_DELETE", "Exam", id, exam.name, { ip });
    return { id };
  }

  /** Make the schedule visible to students and teachers, and put it on the calendar. */
  async publish(actor: Actor, id: number, ip?: string) {
    const exam = await this.exam(actor, id);
    if (exam.status !== "DRAFT") throw conflict(`This exam is already ${exam.status.toLowerCase()}.`);
    if ((await this.prisma.examPaper.count({ where: { examId: id } })) === 0) throw unprocessable("Add at least one paper first.");
    await this.prisma.exam.update({ where: { id }, data: { status: "SCHEDULED" } });
    await this.syncCalendar(actor, id);
    await this.audit.record(actor.userId, "EXAM_PUBLISH", "Exam", id, exam.name, { ip });
    return { id, status: "SCHEDULED" };
  }

  /** Call off an exam no one has submitted marks for; its calendar entry goes with it. */
  async cancel(actor: Actor, id: number, ip?: string) {
    const exam = await this.exam(actor, id);
    if (exam.status === "CANCELLED") return { id, status: "CANCELLED" };
    if ((await this.prisma.markSheet.count({ where: { paper: { examId: id }, status: { not: "DRAFT" } } })) > 0) {
      throw unprocessable("Marks have been submitted for this exam, so it can't be cancelled.");
    }
    await this.prisma.$transaction([
      this.prisma.exam.update({ where: { id }, data: { status: "CANCELLED", calendarEventId: null } }),
      ...(exam.calendarEventId ? [this.prisma.calendarEvent.deleteMany({ where: { id: exam.calendarEventId } })] : []),
    ]);
    await this.audit.record(actor.userId, "EXAM_CANCEL", "Exam", id, exam.name, { ip });
    return { id, status: "CANCELLED" };
  }

  /** The calendar entry spans the first paper's day to the last's. */
  private async syncCalendar(actor: Actor, examId: number) {
    const exam = await this.prisma.exam.findUniqueOrThrow({
      where: { id: examId },
      select: { name: true, termId: true, calendarEventId: true, papers: { select: { date: true } } },
    });
    if (exam.papers.length === 0) return;
    const times = exam.papers.map((p) => p.date.getTime());
    const span = { startDate: new Date(Math.min(...times)), endDate: new Date(Math.max(...times)) };
    const existing = exam.calendarEventId
      ? await this.prisma.calendarEvent.findUnique({ where: { id: exam.calendarEventId }, select: { id: true } })
      : null;
    if (existing) {
      await this.prisma.calendarEvent.update({ where: { id: existing.id }, data: { ...span, title: exam.name } });
      return;
    }
    const event = await this.prisma.calendarEvent.create({
      data: {
        ...inInstitute(actor), termId: exam.termId, title: exam.name, type: "EXAM", audience: "ALL", published: true,
        description: "See the exam schedule for each class's papers.", createdById: actor.userId, ...span,
      },
    });
    await this.prisma.exam.update({ where: { id: examId }, data: { calendarEventId: event.id } });
  }

  private async assertNoPaperClash(actor: Actor, candidate: PaperSlot) {
    const others = await this.prisma.examPaper.findMany({
      where: { date: candidate.date, exam: { ...inInstitute(actor), status: { not: "CANCELLED" } }, ...(candidate.id ? { NOT: { id: candidate.id } } : {}) },
      select: { id: true, courseLevelId: true, date: true, startTime: true, endTime: true, room: true, exam: { select: { name: true } }, subject: { select: { name: true } } },
    });
    const hit = paperClash(candidate, others.map((o) => ({ ...o, label: `${o.exam.name}: ${o.subject.name}` })));
    if (hit) {
      throw conflict(hit.kind === "class" ? `This class already sits "${hit.label}" then.` : `The room is already used by "${hit.label}" then.`, { clash: hit.kind });
    }
  }

  private async checkExaminer(actor: Actor, examinerId: number | null) {
    if (examinerId == null) return;
    const t = await this.prisma.teacherProfile.findFirst({ where: { id: examinerId, user: { ...inInstitute(actor), active: true } }, select: { id: true } });
    if (!t) throw notFound("Examiner");
  }

  async addPaper(actor: Actor, examId: number, input: PaperInput, ip?: string) {
    const exam = await this.exam(actor, examId);
    if (exam.status === "CANCELLED") throw unprocessable("This exam is cancelled.");
    const [level, studied] = await Promise.all([
      this.prisma.courseLevel.findFirst({ where: { id: input.courseLevelId, course: inInstitute(actor) }, select: { id: true } }),
      this.prisma.curriculumSubject.findUnique({
        where: { courseLevelId_subjectId: { courseLevelId: input.courseLevelId, subjectId: input.subjectId } },
        include: { subject: { select: { instituteId: true, name: true } } },
      }),
    ]);
    if (!level) throw notFound("Class");
    if (!studied || studied.subject.instituteId !== actor.instituteId) throw unprocessable("That subject is not in this class's curriculum.");
    await this.checkExaminer(actor, input.examinerId);
    const fullMarks = input.fullMarks ?? studied.fullMarks;
    const passMarks = input.passMarks ?? studied.passMarks;
    if (passMarks > fullMarks) throw unprocessable("Pass marks cannot exceed full marks.");
    await this.assertNoPaperClash(actor, { courseLevelId: input.courseLevelId, date: input.date, startTime: input.startTime, endTime: input.endTime, room: input.room });
    try {
      const row = await this.prisma.examPaper.create({ data: { ...input, examId, fullMarks, passMarks }, select: paperFields });
      if (exam.status === "SCHEDULED") await this.syncCalendar(actor, examId);
      await this.audit.record(actor.userId, "EXAM_PAPER_ADD", "ExamPaper", row.id, `${exam.name}: ${studied.subject.name}`, { ip });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict("This exam already has a paper for that class and subject.");
      throw e;
    }
  }

  /**
   * Reschedule or correct a paper. Once a section has submitted marks the full and pass marks are
   * fixed; full marks can never drop below a mark already entered.
   */
  async updatePaper(actor: Actor, paperId: number, input: PaperUpdateInput, ip?: string) {
    const before = await this.paper(actor, paperId);
    if (before.exam.status === "CANCELLED") throw unprocessable("This exam is cancelled.");
    const marksChanged = input.fullMarks !== before.fullMarks || input.passMarks !== before.passMarks;
    if (marksChanged) {
      if ((await this.prisma.markSheet.count({ where: { paperId, status: { not: "DRAFT" } } })) > 0) {
        throw unprocessable("Marks have been submitted for this paper, so its full and pass marks are fixed.");
      }
      const top = await this.prisma.mark.aggregate({ where: { paperId }, _max: { obtained: true } });
      if ((top._max.obtained ?? 0) > input.fullMarks) throw unprocessable(`A student already has ${top._max.obtained}; full marks cannot go below that.`);
    }
    await this.checkExaminer(actor, input.examinerId);
    await this.assertNoPaperClash(actor, { id: paperId, courseLevelId: before.courseLevelId, date: input.date, startTime: input.startTime, endTime: input.endTime, room: input.room });
    const row = await this.prisma.examPaper.update({ where: { id: paperId }, data: input, select: paperFields });
    if (before.exam.status === "SCHEDULED") await this.syncCalendar(actor, before.examId);
    const { exam: _e, ...plain } = before;
    await this.audit.record(actor.userId, "EXAM_PAPER_EDIT", "ExamPaper", paperId, undefined, { ip, diff: auditDiff(plain, input) });
    return row;
  }

  async removePaper(actor: Actor, paperId: number, ip?: string) {
    const paper = await this.paper(actor, paperId);
    if ((await this.prisma.mark.count({ where: { paperId } })) > 0) throw unprocessable("Marks are already in for this paper, so it can't be removed.");
    await this.prisma.examPaper.delete({ where: { id: paperId } });
    if (paper.exam.status === "SCHEDULED") await this.syncCalendar(actor, paper.examId);
    await this.audit.record(actor.userId, "EXAM_PAPER_REMOVE", "ExamPaper", paperId, undefined, { ip });
    return { id: paperId };
  }

  /**
   * Send a submitted mark sheet back to its teachers for correction. The only way marks change
   * after submission; the reason and who reopened it are kept on the sheet and in the audit log.
   */
  async reopen(actor: Actor, paperId: number, sectionId: number, reason: string, ip?: string) {
    await this.paper(actor, paperId);
    const sheet = await this.prisma.markSheet.findUnique({ where: { paperId_sectionId: { paperId, sectionId } } });
    if (!sheet) throw notFound("Mark sheet");
    if (sheet.status === "LOCKED") throw conflict("These results are approved; the marks are locked.");
    if (sheet.status !== "SUBMITTED") throw conflict("Only a submitted mark sheet can be reopened.");
    const now = new Date();
    await this.prisma.markSheet.update({
      where: { id: sheet.id },
      data: { status: "DRAFT", reopenedById: actor.userId, reopenedAt: now, reopenReason: reason },
    });
    await this.audit.record(actor.userId, "MARKS_REOPEN", "MarkSheet", sheet.id, reason, {
      ip, diff: { before: { status: "SUBMITTED" }, after: { status: "DRAFT", reason } },
    });
    return { paperId, sectionId, status: "DRAFT" };
  }
}
