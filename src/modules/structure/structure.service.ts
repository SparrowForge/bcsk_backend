import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService, auditDiff } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import type { Actor } from "../../common/actor";
import { placeInSection } from "./section-placement";
import type {
  BatchInput, CurriculumInput, DepartmentInput, EnrollmentUpdateInput, SectionInput,
  SectionUpdateInput, SubjectInput, TermInput,
} from "./structure.schema";

const byOrder = [{ displayOrder: "asc" as const }, { id: "asc" as const }];
const activeCount = { _count: { select: { enrollments: { where: { status: "ACTIVE" } } } } } as const;

/** Turn a unique-index clash into a message the form can show. */
function clash(e: unknown, message: string): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return conflict(message);
  return e;
}

/**
 * The academic structure of an institute: departments, terms, the batches and sections of each
 * class, subjects and what each class studies, which student sits in which section, and which
 * teacher teaches what to whom.
 *
 * Every read and write is bounded to the actor's institute. A record of another institute is
 * "not found" (`institute-scope.ts`), including when it arrives as a foreign key in a body -
 * a section cannot be pointed at another school's teacher or class.
 */
@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------- ownership lookups */

  private async department(actor: Actor, id: number) {
    const row = await this.prisma.department.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Department");
    return row;
  }

  private async term(actor: Actor, id: number) {
    const row = await this.prisma.academicTerm.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Term");
    return row;
  }

  private async level(actor: Actor, id: number) {
    const row = await this.prisma.courseLevel.findFirst({
      where: { id, course: inInstitute(actor) },
      select: { id: true, name: true, course: { select: { name: true } } },
    });
    if (!row) throw notFound("Class");
    return row;
  }

  private async batch(actor: Actor, id: number) {
    const row = await this.prisma.batch.findFirst({ where: { id, term: inInstitute(actor) } });
    if (!row) throw notFound("Batch");
    return row;
  }

  private async section(actor: Actor, id: number) {
    const row = await this.prisma.section.findFirst({
      where: { id, batch: { term: inInstitute(actor) } },
      include: { batch: { select: { courseLevelId: true, termId: true } } },
    });
    if (!row) throw notFound("Section");
    return row;
  }

  private async subject(actor: Actor, id: number) {
    const row = await this.prisma.subject.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Subject");
    return row;
  }

  private async teacher(actor: Actor, teacherProfileId: number) {
    const row = await this.prisma.teacherProfile.findFirst({
      where: { id: teacherProfileId, user: { ...inInstitute(actor), active: true } },
      select: { id: true, user: { select: { name: true } } },
    });
    if (!row) throw notFound("Teacher");
    return row;
  }

  private async staffUser(actor: Actor, userId: number) {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, ...inInstitute(actor), active: true, role: { not: "STUDENT" } },
      select: { id: true },
    });
    if (!row) throw notFound("Staff member");
    return row;
  }

  private async student(actor: Actor, userId: number) {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, ...inInstitute(actor), role: "STUDENT", active: true },
      select: { id: true, name: true },
    });
    if (!row) throw notFound("Student");
    return row;
  }

  /* ------------------------------------------------------------------ departments */

  departments(actor: Actor) {
    return this.prisma.department.findMany({
      where: inInstitute(actor),
      orderBy: byOrder,
      include: {
        head: { select: { id: true, name: true } },
        _count: { select: { courses: true, subjects: true } },
      },
    });
  }

  async createDepartment(actor: Actor, input: DepartmentInput, ip?: string) {
    if (input.headUserId) await this.staffUser(actor, input.headUserId);
    try {
      const row = await this.prisma.department.create({ data: { ...input, ...inInstitute(actor) } });
      await this.audit.record(actor.userId, "DEPARTMENT_CREATE", "Department", row.id, row.name, { ip });
      return row;
    } catch (e) {
      throw clash(e, `Department code ${input.code} is already in use.`);
    }
  }

  async updateDepartment(actor: Actor, id: number, input: DepartmentInput, ip?: string) {
    const before = await this.department(actor, id);
    if (input.headUserId) await this.staffUser(actor, input.headUserId);
    try {
      const row = await this.prisma.department.update({ where: { id }, data: input });
      await this.audit.record(actor.userId, "DEPARTMENT_EDIT", "Department", id, row.name, { ip, diff: auditDiff(before, input) });
      return row;
    } catch (e) {
      throw clash(e, `Department code ${input.code} is already in use.`);
    }
  }

  /** Its courses and subjects stay, with no department. */
  async deleteDepartment(actor: Actor, id: number, ip?: string) {
    const row = await this.department(actor, id);
    await this.prisma.department.delete({ where: { id } });
    await this.audit.record(actor.userId, "DEPARTMENT_DELETE", "Department", id, row.name, { ip });
    return { id };
  }

  /* --------------------------------------------------------- courses and classes */

  /** Every course of the institute with its classes (levels): the pickers on the structure screens. */
  levels(actor: Actor) {
    return this.prisma.course.findMany({
      where: inInstitute(actor),
      orderBy: byOrder,
      select: {
        id: true, slug: true, name: true, type: true, active: true,
        department: { select: { id: true, name: true } },
        levels: { orderBy: byOrder, select: { id: true, name: true, code: true } },
      },
    });
  }

  async setCourseDepartment(actor: Actor, courseId: number, departmentId: number | null, ip?: string) {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, ...inInstitute(actor) } });
    if (!course) throw notFound("Course");
    if (departmentId) await this.department(actor, departmentId);
    await this.prisma.course.update({ where: { id: courseId }, data: { departmentId } });
    await this.audit.record(actor.userId, "COURSE_DEPARTMENT", "Course", courseId, course.name, {
      ip, diff: auditDiff({ departmentId: course.departmentId }, { departmentId }),
    });
    return { id: courseId, departmentId };
  }

  /* ------------------------------------------------------------------------ terms */

  terms(actor: Actor) {
    return this.prisma.academicTerm.findMany({
      where: inInstitute(actor),
      orderBy: [{ code: "desc" }],
      include: { _count: { select: { batches: true } } },
    });
  }

  async createTerm(actor: Actor, input: TermInput, ip?: string) {
    try {
      const row = await this.prisma.academicTerm.create({ data: { ...input, ...inInstitute(actor) } });
      await this.audit.record(actor.userId, "TERM_CREATE", "AcademicTerm", row.id, row.code, { ip });
      return row;
    } catch (e) {
      throw clash(e, `Term ${input.code} already exists.`);
    }
  }

  async updateTerm(actor: Actor, id: number, input: TermInput, ip?: string) {
    const before = await this.term(actor, id);
    // The code is what the older tables key on; renaming it would orphan their rows.
    if (input.code !== before.code && (await this.prisma.batch.count({ where: { termId: id } })) > 0) {
      throw unprocessable("This term already has classes; its code can no longer change.");
    }
    try {
      const row = await this.prisma.academicTerm.update({ where: { id }, data: input });
      await this.audit.record(actor.userId, "TERM_EDIT", "AcademicTerm", id, row.code, { ip, diff: auditDiff(before, input) });
      return row;
    } catch (e) {
      throw clash(e, `Term ${input.code} already exists.`);
    }
  }

  /** Exactly one current term per institute: new admissions are placed into it. */
  async setCurrentTerm(actor: Actor, id: number, ip?: string) {
    const term = await this.term(actor, id);
    await this.prisma.$transaction([
      this.prisma.academicTerm.updateMany({ where: { ...inInstitute(actor), isCurrent: true, NOT: { id } }, data: { isCurrent: false } }),
      this.prisma.academicTerm.update({ where: { id }, data: { isCurrent: true } }),
    ]);
    await this.audit.record(actor.userId, "TERM_SET_CURRENT", "AcademicTerm", id, term.code, { ip });
    return { id, isCurrent: true };
  }

  /** Only an empty term: deleting one with classes would cascade away every placement in it. */
  async deleteTerm(actor: Actor, id: number, ip?: string) {
    const term = await this.term(actor, id);
    if ((await this.prisma.batch.count({ where: { termId: id } })) > 0) {
      throw unprocessable("Remove this term's classes first.");
    }
    await this.prisma.academicTerm.delete({ where: { id } });
    await this.audit.record(actor.userId, "TERM_DELETE", "AcademicTerm", id, term.code, { ip });
    return { id };
  }

  /* ---------------------------------------------------------------------- batches */

  batches(actor: Actor, termId?: number) {
    return this.prisma.batch.findMany({
      where: { term: inInstitute(actor), ...(termId ? { termId } : {}) },
      orderBy: [{ termId: "desc" }, { courseLevel: { course: { displayOrder: "asc" } } }, { courseLevel: { displayOrder: "asc" } }],
      include: {
        term: { select: { id: true, code: true, name: true } },
        courseLevel: { select: { id: true, name: true, course: { select: { id: true, name: true } } } },
        sections: { orderBy: { name: "asc" }, select: { id: true, name: true, capacity: true, active: true, ...activeCount } },
      },
    });
  }

  async createBatch(actor: Actor, input: BatchInput, ip?: string) {
    const [level, term] = await Promise.all([this.level(actor, input.courseLevelId), this.term(actor, input.termId)]);
    const name = input.name ?? `${level.course.name} - ${level.name}, ${term.code}`;
    try {
      const row = await this.prisma.batch.create({ data: { courseLevelId: level.id, termId: term.id, name } });
      await this.audit.record(actor.userId, "BATCH_CREATE", "Batch", row.id, row.name, { ip });
      return row;
    } catch (e) {
      throw clash(e, "That class already has a batch in this term.");
    }
  }

  async deleteBatch(actor: Actor, id: number, ip?: string) {
    const batch = await this.batch(actor, id);
    if ((await this.prisma.sectionEnrollment.count({ where: { batchId: id } })) > 0) {
      throw unprocessable("Students are placed in this batch; move or remove them first.");
    }
    await this.prisma.batch.delete({ where: { id } });
    await this.audit.record(actor.userId, "BATCH_DELETE", "Batch", id, batch.name, { ip });
    return { id };
  }

  /* --------------------------------------------------------------------- sections */

  sections(actor: Actor, filter: { termId?: number; courseLevelId?: number }) {
    return this.prisma.section.findMany({
      where: {
        batch: {
          term: inInstitute(actor),
          ...(filter.termId ? { termId: filter.termId } : {}),
          ...(filter.courseLevelId ? { courseLevelId: filter.courseLevelId } : {}),
        },
      },
      orderBy: [{ batchId: "asc" }, { name: "asc" }],
      include: {
        batch: { select: { id: true, name: true, termId: true, courseLevelId: true } },
        classTeacher: { select: { id: true, user: { select: { name: true } } } },
        ...activeCount,
      },
    });
  }

  /** One section in full: its students, who teaches what, and what the class studies. */
  async sectionDetail(actor: Actor, id: number) {
    const section = await this.section(actor, id);
    const [students, assignments, curriculum] = await Promise.all([
      this.prisma.sectionEnrollment.findMany({
        where: { sectionId: id },
        orderBy: [{ rollNo: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        select: {
          id: true, rollNo: true, status: true,
          student: { select: { id: true, name: true, studentProfile: { select: { studentId: true } } } },
        },
      }),
      this.prisma.teacherAssignment.findMany({
        where: { sectionId: id },
        select: {
          id: true,
          subject: { select: { id: true, code: true, name: true } },
          teacher: { select: { id: true, teacherId: true, user: { select: { name: true } } } },
        },
      }),
      this.curriculum(actor, section.batch.courseLevelId),
    ]);
    return { ...section, students, assignments, curriculum };
  }

  private async checkClassTeacher(actor: Actor, classTeacherId: number | null) {
    if (classTeacherId) await this.teacher(actor, classTeacherId);
  }

  async createSection(actor: Actor, input: SectionInput, ip?: string) {
    await this.batch(actor, input.batchId);
    await this.checkClassTeacher(actor, input.classTeacherId);
    try {
      const row = await this.prisma.section.create({ data: input });
      await this.audit.record(actor.userId, "SECTION_CREATE", "Section", row.id, row.name, { ip });
      return row;
    } catch (e) {
      throw clash(e, `Section ${input.name} already exists in this batch.`);
    }
  }

  async updateSection(actor: Actor, id: number, input: SectionUpdateInput, ip?: string) {
    const before = await this.section(actor, id);
    await this.checkClassTeacher(actor, input.classTeacherId);
    if (input.capacity != null) {
      const seated = await this.prisma.sectionEnrollment.count({ where: { sectionId: id, status: "ACTIVE" } });
      if (input.capacity < seated) throw unprocessable(`This section already has ${seated} students.`);
    }
    try {
      const row = await this.prisma.section.update({ where: { id }, data: input });
      const { batch: _b, ...plain } = before;
      await this.audit.record(actor.userId, "SECTION_EDIT", "Section", id, row.name, { ip, diff: auditDiff(plain, input) });
      return row;
    } catch (e) {
      throw clash(e, `Section ${input.name} already exists in this batch.`);
    }
  }

  async deleteSection(actor: Actor, id: number, ip?: string) {
    const section = await this.section(actor, id);
    if ((await this.prisma.sectionEnrollment.count({ where: { sectionId: id } })) > 0) {
      throw unprocessable("Students are placed in this section; move or remove them first.");
    }
    await this.prisma.section.delete({ where: { id } });
    await this.audit.record(actor.userId, "SECTION_DELETE", "Section", id, section.name, { ip });
    return { id };
  }

  /* ------------------------------------------------------------ section enrolment */

  async placeStudent(actor: Actor, sectionId: number, studentUserId: number, rollNo: number | null, ip?: string) {
    const section = await this.section(actor, sectionId);
    const student = await this.student(actor, studentUserId);
    const row = await this.prisma.$transaction((tx) => placeInSection(tx, { studentUserId: student.id, sectionId: section.id, rollNo }));
    await this.audit.record(actor.userId, "SECTION_PLACE", "SectionEnrollment", row.id, `${student.name} -> section ${section.name}`, { ip });
    return row;
  }

  async updateEnrollment(actor: Actor, enrollmentId: number, input: EnrollmentUpdateInput, ip?: string) {
    const before = await this.prisma.sectionEnrollment.findFirst({
      where: { id: enrollmentId, batch: { term: inInstitute(actor) } },
    });
    if (!before) throw notFound("Placement");
    try {
      const row = await this.prisma.sectionEnrollment.update({ where: { id: enrollmentId }, data: input });
      await this.audit.record(actor.userId, "SECTION_PLACEMENT_EDIT", "SectionEnrollment", enrollmentId, undefined, {
        ip, diff: auditDiff(before, input),
      });
      return row;
    } catch (e) {
      throw clash(e, `Roll ${input.rollNo} is already taken in this section.`);
    }
  }

  /** Renumber a section's active students 1..n by name. Cleared first so no number clashes midway. */
  async assignRollNumbers(actor: Actor, sectionId: number, ip?: string) {
    await this.section(actor, sectionId);
    const rows = await this.prisma.sectionEnrollment.findMany({
      where: { sectionId, status: "ACTIVE" },
      orderBy: [{ student: { name: "asc" } }, { id: "asc" }],
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.sectionEnrollment.updateMany({ where: { sectionId }, data: { rollNo: null } }),
      ...rows.map((r, i) => this.prisma.sectionEnrollment.update({ where: { id: r.id }, data: { rollNo: i + 1 } })),
    ]);
    await this.audit.record(actor.userId, "SECTION_ROLL_NUMBERS", "Section", sectionId, `${rows.length} students`, { ip });
    return { sectionId, numbered: rows.length };
  }

  /* -------------------------------------------------------------------- subjects */

  subjects(actor: Actor) {
    return this.prisma.subject.findMany({
      where: inInstitute(actor),
      orderBy: byOrder,
      include: { department: { select: { id: true, name: true } }, _count: { select: { curriculum: true, assignments: true } } },
    });
  }

  async createSubject(actor: Actor, input: SubjectInput, ip?: string) {
    if (input.departmentId) await this.department(actor, input.departmentId);
    try {
      const row = await this.prisma.subject.create({ data: { ...input, ...inInstitute(actor) } });
      await this.audit.record(actor.userId, "SUBJECT_CREATE", "Subject", row.id, row.name, { ip });
      return row;
    } catch (e) {
      throw clash(e, `Subject code ${input.code} is already in use.`);
    }
  }

  async updateSubject(actor: Actor, id: number, input: SubjectInput, ip?: string) {
    const before = await this.subject(actor, id);
    if (input.departmentId) await this.department(actor, input.departmentId);
    try {
      const row = await this.prisma.subject.update({ where: { id }, data: input });
      await this.audit.record(actor.userId, "SUBJECT_EDIT", "Subject", id, row.name, { ip, diff: auditDiff(before, input) });
      return row;
    } catch (e) {
      throw clash(e, `Subject code ${input.code} is already in use.`);
    }
  }

  /** Only a subject nothing uses; one with history is switched off instead (`active: false`). */
  async deleteSubject(actor: Actor, id: number, ip?: string) {
    const subject = await this.subject(actor, id);
    const [inCurriculum, assigned, scheduled] = await Promise.all([
      this.prisma.curriculumSubject.count({ where: { subjectId: id } }),
      this.prisma.teacherAssignment.count({ where: { subjectId: id } }),
      this.prisma.classSession.count({ where: { subjectId: id } }),
    ]);
    if (inCurriculum + assigned + scheduled > 0) {
      throw unprocessable("This subject is in use. Switch it off instead of deleting it.");
    }
    await this.prisma.subject.delete({ where: { id } });
    await this.audit.record(actor.userId, "SUBJECT_DELETE", "Subject", id, subject.name, { ip });
    return { id };
  }

  /* ------------------------------------------------------------------ curriculum */

  async curriculum(actor: Actor, courseLevelId: number) {
    await this.level(actor, courseLevelId);
    return this.prisma.curriculumSubject.findMany({
      where: { courseLevelId },
      orderBy: byOrder,
      include: { subject: { select: { id: true, code: true, name: true, type: true, active: true } } },
    });
  }

  /** Add a subject to a class, or change its marks rules there. */
  async setCurriculumSubject(actor: Actor, courseLevelId: number, subjectId: number, input: CurriculumInput, ip?: string) {
    const [level, subject] = await Promise.all([this.level(actor, courseLevelId), this.subject(actor, subjectId)]);
    const before = await this.prisma.curriculumSubject.findUnique({ where: { courseLevelId_subjectId: { courseLevelId, subjectId } } });
    const row = await this.prisma.curriculumSubject.upsert({
      where: { courseLevelId_subjectId: { courseLevelId, subjectId } },
      create: { courseLevelId, subjectId, ...input },
      update: input,
    });
    await this.audit.record(actor.userId, before ? "CURRICULUM_EDIT" : "CURRICULUM_ADD", "CurriculumSubject", row.id,
      `${subject.name} in ${level.course.name} ${level.name}`, { ip, diff: before ? auditDiff(before, input) : null });
    return row;
  }

  async removeCurriculumSubject(actor: Actor, courseLevelId: number, subjectId: number, ip?: string) {
    const [level, subject] = await Promise.all([this.level(actor, courseLevelId), this.subject(actor, subjectId)]);
    const { count } = await this.prisma.curriculumSubject.deleteMany({ where: { courseLevelId, subjectId } });
    if (count === 0) throw notFound("Subject in this class");
    await this.audit.record(actor.userId, "CURRICULUM_REMOVE", "CurriculumSubject", undefined,
      `${subject.name} from ${level.course.name} ${level.name}`, { ip });
    return { courseLevelId, subjectId };
  }

  /* ---------------------------------------------------------- teacher assignment */

  /**
   * Assign a teacher to teach a subject in a section. The subject must be in the class's
   * curriculum, so an assignment can never name a subject the class does not study.
   */
  async assignTeacher(actor: Actor, sectionId: number, teacherProfileId: number, subjectId: number, ip?: string) {
    const section = await this.section(actor, sectionId);
    const [teacher, subject] = await Promise.all([this.teacher(actor, teacherProfileId), this.subject(actor, subjectId)]);
    const taught = await this.prisma.curriculumSubject.findUnique({
      where: { courseLevelId_subjectId: { courseLevelId: section.batch.courseLevelId, subjectId } },
    });
    if (!taught) throw unprocessable(`${subject.name} is not in this class's curriculum. Add it there first.`);
    try {
      const row = await this.prisma.teacherAssignment.create({ data: { teacherProfileId, sectionId, subjectId } });
      await this.audit.record(actor.userId, "TEACHER_ASSIGN", "TeacherAssignment", row.id,
        `${teacher.user.name}: ${subject.name}, section ${section.name}`, { ip });
      return row;
    } catch (e) {
      throw clash(e, `${teacher.user.name} already teaches ${subject.name} in this section.`);
    }
  }

  async unassignTeacher(actor: Actor, assignmentId: number, ip?: string) {
    const row = await this.prisma.teacherAssignment.findFirst({
      where: { id: assignmentId, section: { batch: { term: inInstitute(actor) } } },
      select: { id: true, teacherProfileId: true, sectionId: true, subjectId: true },
    });
    if (!row) throw notFound("Assignment");
    await this.prisma.teacherAssignment.delete({ where: { id: assignmentId } });
    await this.audit.record(actor.userId, "TEACHER_UNASSIGN", "TeacherAssignment", assignmentId,
      `teacher ${row.teacherProfileId}, section ${row.sectionId}, subject ${row.subjectId}`, { ip });
    return { id: assignmentId };
  }

  /* ------------------------------------------------------------- people pickers */

  /** Active teachers of the institute, for class-teacher and assignment pickers. */
  teachers(actor: Actor) {
    return this.prisma.teacherProfile.findMany({
      where: { user: { ...inInstitute(actor), active: true } },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: { id: true, teacherId: true, designation: true, user: { select: { id: true, name: true } } },
    });
  }

  /**
   * Active students of the institute with their placements, optionally only those not yet
   * placed in any class of a term - the queue the office works through at term start.
   */
  students(actor: Actor, filter: { q?: string; unplacedInTermId?: number }) {
    return this.prisma.user.findMany({
      where: {
        ...inInstitute(actor),
        role: "STUDENT",
        active: true,
        ...(filter.q
          ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { loginId: { contains: filter.q, mode: "insensitive" } }] }
          : {}),
        ...(filter.unplacedInTermId ? { sectionPlaces: { none: { batch: { termId: filter.unplacedInTermId } } } } : {}),
      },
      orderBy: { name: "asc" },
      take: 200,
      select: {
        id: true, name: true, loginId: true,
        studentProfile: { select: { classLevel: true, status: true } },
        sectionPlaces: {
          where: { status: "ACTIVE" },
          select: { id: true, rollNo: true, section: { select: { id: true, name: true, batch: { select: { id: true, name: true, termId: true } } } } },
        },
      },
    });
  }
}
