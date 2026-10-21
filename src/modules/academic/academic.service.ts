import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, notFound } from "../../common/errors/app-error";
import type { Actor } from "../../common/actor";
import type { AcademicClassInput, ClassSubjectInput } from "./academic.schema";

const subjectOrder = [{ displayOrder: "asc" as const }, { id: "asc" as const }];

/**
 * The general classes and their books, as the public Academic pages show them. Everything here
 * is written from the admin panel; the public reads only ever see active classes.
 */
@Injectable()
export class AcademicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The class cards. No subjects - the list page does not show them. */
  publicClasses() {
    return this.prisma.academicClass.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      select: { id: true, slug: true, name: true, ageRange: true, summary: true, color: true, cardImageUrl: true },
    });
  }

  async publicClass(slug: string) {
    const row = await this.prisma.academicClass.findFirst({
      where: { slug, active: true },
      include: { subjects: { orderBy: subjectOrder } },
    });
    if (!row) throw notFound("Class");
    return row;
  }

  /** Every class, active or not, with its subject count, for the admin list. */
  adminClasses() {
    return this.prisma.academicClass.findMany({
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      include: { _count: { select: { subjects: true } } },
    });
  }

  async adminClass(id: number) {
    const row = await this.prisma.academicClass.findUnique({
      where: { id },
      include: { subjects: { orderBy: subjectOrder } },
    });
    if (!row) throw notFound("Class");
    return row;
  }

  async createClass(input: AcademicClassInput, actor: Actor) {
    try {
      const row = await this.prisma.academicClass.create({ data: input });
      await this.audit.record(actor.userId, "ACADEMIC_CLASS_CREATE", "AcademicClass", row.id, row.name);
      return row;
    } catch (e) {
      throw this.slugClash(e);
    }
  }

  async updateClass(id: number, input: AcademicClassInput, actor: Actor) {
    await this.adminClass(id);
    try {
      const row = await this.prisma.academicClass.update({ where: { id }, data: input });
      await this.audit.record(actor.userId, "ACADEMIC_CLASS_EDIT", "AcademicClass", id, row.name);
      return row;
    } catch (e) {
      throw this.slugClash(e);
    }
  }

  /** Removes the class and, by cascade, its subjects. */
  async deleteClass(id: number, actor: Actor) {
    const row = await this.adminClass(id);
    await this.prisma.academicClass.delete({ where: { id } });
    await this.audit.record(actor.userId, "ACADEMIC_CLASS_DELETE", "AcademicClass", id, row.name);
    return { id };
  }

  async addSubject(classId: number, input: ClassSubjectInput, actor: Actor) {
    await this.adminClass(classId);
    const row = await this.prisma.classSubject.create({ data: { ...input, classId } });
    await this.audit.record(actor.userId, "CLASS_SUBJECT_CREATE", "ClassSubject", row.id, row.title);
    return row;
  }

  async updateSubject(id: number, input: ClassSubjectInput, actor: Actor) {
    const existing = await this.prisma.classSubject.findUnique({ where: { id } });
    if (!existing) throw notFound("Subject");
    const row = await this.prisma.classSubject.update({ where: { id }, data: input });
    await this.audit.record(actor.userId, "CLASS_SUBJECT_EDIT", "ClassSubject", id, row.title);
    return row;
  }

  async deleteSubject(id: number, actor: Actor) {
    const existing = await this.prisma.classSubject.findUnique({ where: { id } });
    if (!existing) throw notFound("Subject");
    await this.prisma.classSubject.delete({ where: { id } });
    await this.audit.record(actor.userId, "CLASS_SUBJECT_DELETE", "ClassSubject", id, existing.title);
    return { id };
  }

  private slugClash(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return conflict("Another class already uses that page address.");
    }
    return e;
  }
}
