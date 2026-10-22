import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, forbidden, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import { schoolToday } from "../../common/constants";
import type { Actor } from "../../common/actor";
import { assertTeaches, teacherProfileId } from "../structure/teaching-scope";
import type { MarkEntry } from "./exam.schema";

/**
 * Marks entry. A section's marks for a paper are entered by a teacher who teaches that subject
 * in that section, or by the paper's examiner; the exam must be scheduled and the paper's day
 * must have come. Marks are saved as a draft as often as needed, then submitted once complete -
 * every student has a mark or is marked absent. A submitted sheet is read-only to teachers; only
 * the Head Master can reopen it (ExamService.reopen).
 */
@Injectable()
export class MarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The paper and section, checked to belong together and to the institute. */
  private async target(actor: Actor, paperId: number, sectionId: number) {
    const paper = await this.prisma.examPaper.findFirst({
      where: { id: paperId, exam: inInstitute(actor) },
      include: { exam: { select: { id: true, name: true, status: true, termId: true } }, subject: { select: { name: true } } },
    });
    if (!paper) throw notFound("Paper");
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, batch: { courseLevelId: paper.courseLevelId, termId: paper.exam.termId } },
      select: { id: true, name: true },
    });
    if (!section) throw notFound("Section sitting this paper");
    return { paper, section };
  }

  /** May this teacher mark this paper for this section? */
  private async assertCanMark(actor: Actor, paper: { examinerId: number | null; subjectId: number }, sectionId: number) {
    const profileId = await teacherProfileId(this.prisma, actor);
    if (paper.examinerId === profileId) return;
    await assertTeaches(this.prisma, actor, sectionId, paper.subjectId);
  }

  private async grid(paperId: number, sectionId: number) {
    const [students, marks, sheet] = await Promise.all([
      this.prisma.sectionEnrollment.findMany({
        where: { sectionId, status: "ACTIVE" },
        orderBy: [{ rollNo: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        select: { rollNo: true, student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } } },
      }),
      this.prisma.mark.findMany({ where: { paperId, sectionId }, select: { studentUserId: true, obtained: true, isAbsent: true, updatedAt: true } }),
      this.prisma.markSheet.findUnique({ where: { paperId_sectionId: { paperId, sectionId } } }),
    ]);
    const byStudent = new Map(marks.map((m) => [m.studentUserId, m]));
    return {
      status: sheet?.status ?? "NOT_STARTED",
      submittedAt: sheet?.submittedAt ?? null,
      reopenReason: sheet?.status === "DRAFT" ? sheet.reopenReason : null,
      students: students.map((s) => ({
        rollNo: s.rollNo,
        student: s.student,
        obtained: byStudent.get(s.student.id)?.obtained ?? null,
        isAbsent: byStudent.get(s.student.id)?.isAbsent ?? false,
      })),
    };
  }

  /** Teacher: the marks grid of one section for one paper. */
  async teacherGrid(actor: Actor, paperId: number, sectionId: number) {
    const { paper, section } = await this.target(actor, paperId, sectionId);
    await this.assertCanMark(actor, paper, sectionId);
    return { paper: this.paperSummary(paper), section, ...(await this.grid(paperId, sectionId)) };
  }

  /** Head Master: the same grid, read-only. */
  async managerGrid(actor: Actor, paperId: number, sectionId: number) {
    const { paper, section } = await this.target(actor, paperId, sectionId);
    return { paper: this.paperSummary(paper), section, ...(await this.grid(paperId, sectionId)) };
  }

  private paperSummary(p: { id: number; date: Date; startTime: string; fullMarks: number; passMarks: number; subject: { name: string }; exam: { id: number; name: string; status: string } }) {
    return { id: p.id, exam: p.exam, subject: p.subject.name, date: p.date, startTime: p.startTime, fullMarks: p.fullMarks, passMarks: p.passMarks };
  }

  /** Is this sheet open for a teacher to write? */
  private async writable(actor: Actor, paperId: number, sectionId: number) {
    const { paper, section } = await this.target(actor, paperId, sectionId);
    await this.assertCanMark(actor, paper, sectionId);
    if (paper.exam.status !== "SCHEDULED") throw unprocessable(`This exam is ${paper.exam.status.toLowerCase()}; marks can't be entered.`);
    if (paper.date.toISOString().slice(0, 10) > schoolToday()) throw unprocessable("This paper has not been sat yet.");
    const sheet = await this.prisma.markSheet.findUnique({ where: { paperId_sectionId: { paperId, sectionId } } });
    if (sheet && sheet.status !== "DRAFT") {
      throw conflict(sheet.status === "LOCKED" ? "These results are approved; the marks are locked." : "These marks are submitted. Ask the Head Master to reopen them.");
    }
    return { paper, section, sheet };
  }

  /**
   * Save marks as a draft. Only the section's own students are written - anyone else in the list
   * is reported back, not stored. An entry with neither marks nor absence clears that student.
   */
  async save(actor: Actor, paperId: number, sectionId: number, entries: MarkEntry[]) {
    const { paper, sheet } = await this.writable(actor, paperId, sectionId);
    const members = new Set(
      (await this.prisma.sectionEnrollment.findMany({ where: { sectionId, status: "ACTIVE" }, select: { studentUserId: true } })).map((m) => m.studentUserId),
    );
    const problems: string[] = [];
    const writes = [];
    const clears: number[] = [];
    for (const e of entries) {
      if (!members.has(e.studentUserId)) { problems.push(`Student ${e.studentUserId} is not in this section.`); continue; }
      if (e.isAbsent) {
        writes.push({ studentUserId: e.studentUserId, obtained: null, isAbsent: true });
      } else if (e.obtained == null) {
        clears.push(e.studentUserId);
      } else if (e.obtained > paper.fullMarks) {
        problems.push(`${e.obtained} is more than the full marks (${paper.fullMarks}).`);
      } else {
        writes.push({ studentUserId: e.studentUserId, obtained: e.obtained, isAbsent: false });
      }
    }
    if (problems.length > 0) throw unprocessable(problems[0]!, { problems: problems.length });

    // LMS B7: once a sheet has been submitted and reopened, every change to a mark is audited with
    // its old and new value - the "marks edits after submission" the audit list names.
    const reopened = sheet?.reopenedAt != null;
    const before = reopened
      ? new Map((await this.prisma.mark.findMany({ where: { paperId, sectionId }, select: { studentUserId: true, obtained: true, isAbsent: true } }))
        .map((m) => [m.studentUserId, m.isAbsent ? "absent" : m.obtained]))
      : null;

    await this.prisma.$transaction([
      this.prisma.markSheet.upsert({
        where: { paperId_sectionId: { paperId, sectionId } },
        create: { paperId, sectionId },
        update: {},
      }),
      ...writes.map((w) =>
        this.prisma.mark.upsert({
          where: { paperId_studentUserId: { paperId, studentUserId: w.studentUserId } },
          create: { paperId, sectionId, ...w, enteredById: actor.userId },
          update: { obtained: w.obtained, isAbsent: w.isAbsent, enteredById: actor.userId },
        }),
      ),
      ...(clears.length ? [this.prisma.mark.deleteMany({ where: { paperId, studentUserId: { in: clears } } })] : []),
    ]);
    if (before) {
      const after = new Map<number, number | string | null>([
        ...writes.map((w) => [w.studentUserId, w.isAbsent ? "absent" : w.obtained] as const),
        ...clears.map((id) => [id, null] as const),
      ]);
      const changed = [...after.entries()].filter(([id, v]) => (before.get(id) ?? null) !== v);
      if (changed.length > 0) {
        await this.audit.record(actor.userId, "MARKS_EDIT_AFTER_SUBMIT", "MarkSheet", `${paperId}/${sectionId}`, `${changed.length} mark(s) changed`, {
          diff: {
            before: Object.fromEntries(changed.map(([id]) => [String(id), before.get(id) ?? null])),
            after: Object.fromEntries(changed.map(([id, v]) => [String(id), v])),
          },
        });
      }
    }
    return { saved: writes.length, cleared: clears.length };
  }

  /** Submit a complete sheet. Every student needs marks or an absence. */
  async submit(actor: Actor, paperId: number, sectionId: number) {
    const { paper, section } = await this.writable(actor, paperId, sectionId);
    const [students, marks] = await Promise.all([
      this.prisma.sectionEnrollment.findMany({ where: { sectionId, status: "ACTIVE" }, select: { studentUserId: true } }),
      this.prisma.mark.findMany({ where: { paperId, sectionId }, select: { studentUserId: true, obtained: true, isAbsent: true } }),
    ]);
    const done = new Set(marks.filter((m) => m.isAbsent || m.obtained != null).map((m) => m.studentUserId));
    const missing = students.filter((s) => !done.has(s.studentUserId)).length;
    if (students.length === 0) throw unprocessable("This section has no students.");
    if (missing > 0) throw unprocessable(`${missing} student${missing === 1 ? " has" : "s have"} no marks yet. Enter marks or mark them absent.`, { missing });
    await this.prisma.markSheet.upsert({
      where: { paperId_sectionId: { paperId, sectionId } },
      create: { paperId, sectionId, status: "SUBMITTED", submittedById: actor.userId, submittedAt: new Date() },
      update: { status: "SUBMITTED", submittedById: actor.userId, submittedAt: new Date() },
    });
    await this.audit.record(actor.userId, "MARKS_SUBMIT", "MarkSheet", `${paperId}/${sectionId}`,
      `${paper.exam.name}: ${paper.subject.name}, section ${section.name}`);
    return { paperId, sectionId, status: "SUBMITTED" };
  }

  /**
   * Teacher: the scheduled papers of the current term they mark - by teaching the subject in a
   * section of that class, or as examiner - with each of their sections' sheet state.
   */
  async teacherPapers(actor: Actor) {
    if (actor.role !== "TEACHER") throw forbidden();
    const profileId = await teacherProfileId(this.prisma, actor);
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { teacherProfileId: profileId, section: { active: true, batch: { term: { ...inInstitute(actor), isCurrent: true } } } },
      select: { subjectId: true, section: { select: { id: true, name: true, batch: { select: { courseLevelId: true } } } } },
    });
    const papers = await this.prisma.examPaper.findMany({
      where: {
        exam: { ...inInstitute(actor), status: "SCHEDULED", term: { isCurrent: true } },
        OR: [
          { examinerId: profileId },
          ...assignments.map((a) => ({ courseLevelId: a.section.batch.courseLevelId, subjectId: a.subjectId })),
        ],
      },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      select: {
        id: true, date: true, startTime: true, endTime: true, room: true, fullMarks: true, passMarks: true, examinerId: true,
        courseLevelId: true, subjectId: true,
        exam: { select: { id: true, name: true, termId: true } },
        subject: { select: { name: true } },
        courseLevel: { select: { name: true } },
        sheets: { select: { sectionId: true, status: true } },
      },
    });
    const examinerSections = await this.prisma.section.findMany({
      where: { active: true, batch: { courseLevelId: { in: papers.filter((p) => p.examinerId === profileId).map((p) => p.courseLevelId) }, term: { isCurrent: true } } },
      select: { id: true, name: true, batch: { select: { courseLevelId: true } } },
    });
    return papers.map(({ sheets, ...p }) => {
      const mine = p.examinerId === profileId
        ? examinerSections.filter((s) => s.batch.courseLevelId === p.courseLevelId)
        : assignments.filter((a) => a.subjectId === p.subjectId && a.section.batch.courseLevelId === p.courseLevelId).map((a) => a.section);
      return {
        ...p,
        sections: mine.map((s) => ({ sectionId: s.id, section: s.name, status: sheets.find((x) => x.sectionId === s.id)?.status ?? "NOT_STARTED" })),
      };
    });
  }

  /** Student: the published exam schedule for their classes this term. */
  async studentSchedule(actor: Actor) {
    const places = await this.prisma.sectionEnrollment.findMany({
      where: { studentUserId: actor.userId, status: "ACTIVE", batch: { term: { ...inInstitute(actor), isCurrent: true } } },
      select: { batch: { select: { courseLevelId: true, termId: true } } },
    });
    if (places.length === 0) return [];
    const exams = await this.prisma.exam.findMany({
      where: { ...inInstitute(actor), status: "SCHEDULED", termId: { in: [...new Set(places.map((p) => p.batch.termId))] } },
      orderBy: { id: "asc" },
      select: {
        id: true, name: true, type: true, instructions: true,
        papers: {
          where: { courseLevelId: { in: places.map((p) => p.batch.courseLevelId) } },
          orderBy: [{ date: "asc" }, { startTime: "asc" }],
          select: { id: true, date: true, startTime: true, endTime: true, room: true, fullMarks: true, passMarks: true, subject: { select: { name: true } }, courseLevel: { select: { name: true } } },
        },
      },
    });
    // An exam none of the student's classes sit is not theirs to see.
    return exams.filter((e) => e.papers.length > 0);
  }
}
