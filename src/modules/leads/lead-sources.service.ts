import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service";
import { conflict, notFound } from "../../common/errors/app-error";
import { sourceSchema } from "./leads.schema";

type SourceInput = z.infer<typeof sourceSchema>;

@Injectable()
export class LeadSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.leadSource.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { leads: true } } },
    });
  }

  /** Sources offered on the public enquiry form's "How did you hear about us?" dropdown. */
  publicList() {
    return this.prisma.leadSource.findMany({
      where: { isPublic: true, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true },
    });
  }

  async create(input: SourceInput) {
    try {
      return await this.prisma.leadSource.create({ data: input });
    } catch (e) {
      throw this.nameClash(e);
    }
  }

  async update(id: number, input: Partial<SourceInput>) {
    if (!(await this.prisma.leadSource.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Lead source");
    try {
      return await this.prisma.leadSource.update({ where: { id }, data: input });
    } catch (e) {
      throw this.nameClash(e);
    }
  }

  /** Leads keep their history, so a source in use is deactivated rather than deleted. */
  async remove(id: number) {
    const src = await this.prisma.leadSource.findUnique({ where: { id }, include: { _count: { select: { leads: true } } } });
    if (!src) throw notFound("Lead source");
    if (src._count.leads > 0) {
      await this.prisma.leadSource.update({ where: { id }, data: { active: false, isPublic: false } });
      return { ok: true, deactivated: true };
    }
    await this.prisma.leadSource.delete({ where: { id } });
    return { ok: true, deactivated: false };
  }

  private nameClash(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return conflict("A lead source with that name already exists.");
    }
    return e;
  }
}
