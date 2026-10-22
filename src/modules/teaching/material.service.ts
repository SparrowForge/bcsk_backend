import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService, auditDiff } from "../../common/audit.service";
import { forbidden, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import type { Actor } from "../../common/actor";
import { assertTeaches } from "../structure/teaching-scope";
import type { ManagedMaterialInput, TeacherMaterialInput } from "./material.schema";

const fields = {
  id: true, title: true, description: true, kind: true, fileUrl: true, linkUrl: true, published: true,
  displayOrder: true, sectionId: true, courseLevelId: true, createdAt: true, updatedAt: true, uploadedById: true,
  subject: { select: { id: true, code: true, name: true } },
  courseLevel: { select: { id: true, name: true } },
  section: { select: { id: true, name: true } },
} as const;
const order = [{ displayOrder: "asc" as const }, { createdAt: "desc" as const }];

/**
 * Course materials. Who may write what:
 *  - the Head Master (`materials:manage`) - any class of the institute, for every section or one;
 *  - a teacher - their own section, only for a subject they teach there; and they may change or
 *    remove only what they put up themselves.
 * Students read the published materials of their own sections this term: those for their section
 * and those for every section of their class. Files live under `materials/` behind the file
 * policy; links must be https.
 */
@Injectable()
export class MaterialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Tell the students a material reaches, once, when it is published. */
  private async notify(material: { title: string; courseLevelId: number; sectionId: number | null; subject: { name: string } }, instituteId: number) {
    const students = await this.prisma.sectionEnrollment.findMany({
      where: {
        status: "ACTIVE",
        ...(material.sectionId != null
          ? { sectionId: material.sectionId }
          : { batch: { courseLevelId: material.courseLevelId, term: { instituteId, isCurrent: true } } }),
      },
      select: { studentUserId: true },
    });
    if (students.length === 0) return;
    await this.prisma.notification.createMany({
      data: [...new Set(students.map((s) => s.studentUserId))].map((userId) => ({
        userId, kind: "GENERAL", title: `New material: ${material.title}`, body: material.subject.name, link: "/classroom/materials",
      })),
    });
  }

  /* ----------------------------------------------------------------- teacher */

  /** Materials of the teacher's sections this term: section ones and class-wide ones for their subjects. */
  async teacherList(actor: Actor) {
    const assignments = await this.prisma.teacherAssignment.findMany({
      where: { teacher: { userId: actor.userId }, section: { batch: { term: { ...inInstitute(actor), isCurrent: true } } } },
      select: { sectionId: true, subjectId: true, section: { select: { batch: { select: { courseLevelId: true } } } } },
    });
    if (assignments.length === 0) return [];
    const where: Prisma.CourseMaterialWhereInput = {
      OR: assignments.flatMap((a) => [
        { sectionId: a.sectionId, subjectId: a.subjectId },
        { sectionId: null, courseLevelId: a.section.batch.courseLevelId, subjectId: a.subjectId },
      ]),
    };
    return this.prisma.courseMaterial.findMany({ where, orderBy: order, select: fields });
  }

  async teacherCreate(actor: Actor, sectionId: number, input: TeacherMaterialInput) {
    await assertTeaches(this.prisma, actor, sectionId, input.subjectId);
    const section = await this.prisma.section.findUniqueOrThrow({ where: { id: sectionId }, select: { batch: { select: { courseLevelId: true } } } });
    const row = await this.prisma.courseMaterial.create({
      data: { ...input, sectionId, courseLevelId: section.batch.courseLevelId, uploadedById: actor.userId },
      select: fields,
    });
    if (row.published) await this.notify(row, actor.instituteId);
    await this.audit.record(actor.userId, "MATERIAL_CREATE", "CourseMaterial", row.id, row.title);
    return row;
  }

  /** A material the teacher put up, in a section where they still teach its subject. */
  private async teacherOwned(actor: Actor, id: number) {
    const row = await this.prisma.courseMaterial.findUnique({ where: { id } });
    if (!row) throw notFound("Material");
    if (row.uploadedById !== actor.userId || row.sectionId == null) throw forbidden("You can only change materials you put up.");
    await assertTeaches(this.prisma, actor, row.sectionId, row.subjectId);
    return row;
  }

  async teacherUpdate(actor: Actor, id: number, input: TeacherMaterialInput) {
    const before = await this.teacherOwned(actor, id);
    if (input.subjectId !== before.subjectId) await assertTeaches(this.prisma, actor, before.sectionId!, input.subjectId);
    const row = await this.prisma.courseMaterial.update({ where: { id }, data: input, select: fields });
    if (row.published && !before.published) await this.notify(row, actor.instituteId);
    await this.audit.record(actor.userId, "MATERIAL_EDIT", "CourseMaterial", id, row.title, { diff: auditDiff(before, input) });
    return row;
  }

  async teacherDelete(actor: Actor, id: number) {
    const row = await this.teacherOwned(actor, id);
    await this.prisma.courseMaterial.delete({ where: { id } });
    await this.audit.record(actor.userId, "MATERIAL_DELETE", "CourseMaterial", id, row.title);
    return { id };
  }

  /* ----------------------------------------------------------------- manager */

  manageList(actor: Actor, filter: { courseLevelId?: number; sectionId?: number; subjectId?: number }) {
    return this.prisma.courseMaterial.findMany({
      where: {
        courseLevel: { course: inInstitute(actor) },
        ...(filter.courseLevelId ? { courseLevelId: filter.courseLevelId } : {}),
        ...(filter.sectionId ? { sectionId: filter.sectionId } : {}),
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      },
      orderBy: order,
      take: 500,
      select: fields,
    });
  }

  /** The class, subject and (optional) section must all be the institute's, and fit together. */
  private async checkTarget(actor: Actor, input: ManagedMaterialInput) {
    const [level, subject, section] = await Promise.all([
      this.prisma.courseLevel.findFirst({ where: { id: input.courseLevelId, course: inInstitute(actor) }, select: { id: true } }),
      this.prisma.subject.findFirst({ where: { id: input.subjectId, ...inInstitute(actor) }, select: { id: true } }),
      input.sectionId != null
        ? this.prisma.section.findFirst({ where: { id: input.sectionId, batch: { term: inInstitute(actor) } }, select: { batch: { select: { courseLevelId: true } } } })
        : Promise.resolve(null),
    ]);
    if (!level) throw notFound("Class");
    if (!subject) throw notFound("Subject");
    if (input.sectionId != null) {
      if (!section) throw notFound("Section");
      if (section.batch.courseLevelId !== input.courseLevelId) throw unprocessable("That section is not in this class.");
    }
  }

  private async managed(actor: Actor, id: number) {
    const row = await this.prisma.courseMaterial.findFirst({ where: { id, courseLevel: { course: inInstitute(actor) } } });
    if (!row) throw notFound("Material");
    return row;
  }

  async manageCreate(actor: Actor, input: ManagedMaterialInput, ip?: string) {
    await this.checkTarget(actor, input);
    const row = await this.prisma.courseMaterial.create({ data: { ...input, uploadedById: actor.userId }, select: fields });
    if (row.published) await this.notify(row, actor.instituteId);
    await this.audit.record(actor.userId, "MATERIAL_CREATE", "CourseMaterial", row.id, row.title, { ip });
    return row;
  }

  async manageUpdate(actor: Actor, id: number, input: ManagedMaterialInput, ip?: string) {
    const before = await this.managed(actor, id);
    await this.checkTarget(actor, input);
    const row = await this.prisma.courseMaterial.update({ where: { id }, data: input, select: fields });
    if (row.published && !before.published) await this.notify(row, actor.instituteId);
    await this.audit.record(actor.userId, "MATERIAL_EDIT", "CourseMaterial", id, row.title, { ip, diff: auditDiff(before, input) });
    return row;
  }

  async manageDelete(actor: Actor, id: number, ip?: string) {
    const row = await this.managed(actor, id);
    await this.prisma.courseMaterial.delete({ where: { id } });
    await this.audit.record(actor.userId, "MATERIAL_DELETE", "CourseMaterial", id, row.title, { ip });
    return { id };
  }

  /* ----------------------------------------------------------------- student */

  /** Published materials for the student's sections this term, optionally one subject's. */
  async studentList(actor: Actor, subjectId?: number) {
    const places = await this.prisma.sectionEnrollment.findMany({
      where: { studentUserId: actor.userId, status: "ACTIVE", batch: { term: { ...inInstitute(actor), isCurrent: true } } },
      select: { sectionId: true, batch: { select: { courseLevelId: true } } },
    });
    if (places.length === 0) return [];
    return this.prisma.courseMaterial.findMany({
      where: {
        published: true,
        ...(subjectId ? { subjectId } : {}),
        OR: places.flatMap((p) => [{ sectionId: p.sectionId }, { sectionId: null, courseLevelId: p.batch.courseLevelId }]),
      },
      orderBy: order,
      select: fields,
    });
  }
}
