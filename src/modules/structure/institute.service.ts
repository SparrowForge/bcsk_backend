import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService, auditDiff } from "../../common/audit.service";
import { conflict, notFound } from "../../common/errors/app-error";
import type { Actor } from "../../common/actor";
import type { InstituteInput, InstituteProfileInput } from "./structure.schema";

/**
 * Institutes. A super admin opens and lists them; each institute's own profile (name, address,
 * logo, the signatory printed on reports) is edited by whoever holds `institute:manage` there.
 */
@Injectable()
export class InstituteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.prisma.institute.findMany({
      orderBy: { id: "asc" },
      include: { _count: { select: { users: true, courses: true } } },
    });
  }

  async create(actor: Actor, input: InstituteInput, ip?: string) {
    try {
      const row = await this.prisma.institute.create({ data: input });
      await this.audit.record(actor.userId, "INSTITUTE_CREATE", "Institute", row.id, row.code, { ip });
      return row;
    } catch (e) {
      throw this.codeClash(e, input.code);
    }
  }

  async update(actor: Actor, id: number, input: InstituteInput, ip?: string) {
    const before = await this.prisma.institute.findUnique({ where: { id } });
    if (!before) throw notFound("Institute");
    try {
      const row = await this.prisma.institute.update({ where: { id }, data: input });
      await this.audit.record(actor.userId, "INSTITUTE_EDIT", "Institute", id, row.code, { ip, diff: auditDiff(before, input) });
      return row;
    } catch (e) {
      throw this.codeClash(e, input.code);
    }
  }

  async own(actor: Actor) {
    const row = await this.prisma.institute.findUnique({ where: { id: actor.instituteId } });
    if (!row) throw notFound("Institute");
    return row;
  }

  async updateOwn(actor: Actor, input: InstituteProfileInput, ip?: string) {
    const before = await this.own(actor);
    const row = await this.prisma.institute.update({ where: { id: actor.instituteId }, data: input });
    await this.audit.record(actor.userId, "INSTITUTE_PROFILE_EDIT", "Institute", row.id, row.code, { ip, diff: auditDiff(before, input) });
    return row;
  }

  private codeClash(e: unknown, code: string) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return conflict(`Institute code ${code} is already in use.`);
    }
    return e;
  }
}
