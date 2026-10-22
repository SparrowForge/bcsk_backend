import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import type { Actor } from "../../common/actor";
import { BD_GPA_5 } from "./grading";
import type { SchemeInput } from "./exam.schema";

const withBands = { bands: { orderBy: { minPercent: "desc" as const } } } as const;

/**
 * Grading schemes of an institute. Every institute has at least one: an institute with none
 * (one opened after the B4 migration seeded BCSK's) is given Bangladesh GPA 5.0 the first time
 * its schemes are read. A scheme's bands cannot change once an exam using it has left draft -
 * that would quietly regrade marks already entered.
 */
@Injectable()
export class GradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: Actor) {
    const rows = await this.prisma.gradingScheme.findMany({ where: inInstitute(actor), orderBy: { id: "asc" }, include: withBands });
    if (rows.length > 0) return rows;
    await this.prisma.gradingScheme.create({
      data: { ...inInstitute(actor), name: "Bangladesh GPA 5.0", kind: "GPA", isDefault: true, bands: { create: BD_GPA_5 } },
    });
    return this.prisma.gradingScheme.findMany({ where: inInstitute(actor), orderBy: { id: "asc" }, include: withBands });
  }

  /** The scheme an exam uses: the one named, else the institute's default. */
  async resolve(actor: Actor, schemeId: number | null) {
    if (schemeId != null) {
      const row = await this.prisma.gradingScheme.findFirst({ where: { id: schemeId, ...inInstitute(actor), active: true }, select: { id: true } });
      if (!row) throw notFound("Grading scheme");
      return row.id;
    }
    const schemes = await this.list(actor);
    const chosen = schemes.find((s) => s.isDefault && s.active) ?? schemes.find((s) => s.active);
    if (!chosen) throw unprocessable("Set up a grading scheme first.");
    return chosen.id;
  }

  async create(actor: Actor, input: SchemeInput, ip?: string) {
    const { bands, ...scheme } = input;
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        if (scheme.isDefault) await tx.gradingScheme.updateMany({ where: { ...inInstitute(actor), isDefault: true }, data: { isDefault: false } });
        return tx.gradingScheme.create({ data: { ...scheme, ...inInstitute(actor), bands: { create: bands } }, include: withBands });
      });
      await this.audit.record(actor.userId, "GRADING_SCHEME_CREATE", "GradingScheme", row.id, row.name, { ip });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict(`A scheme called ${scheme.name} already exists.`);
      throw e;
    }
  }

  async update(actor: Actor, id: number, input: SchemeInput, ip?: string) {
    const before = await this.prisma.gradingScheme.findFirst({ where: { id, ...inInstitute(actor) }, include: withBands });
    if (!before) throw notFound("Grading scheme");
    const { bands, ...scheme } = input;
    const sameBands = JSON.stringify(before.bands.map((b) => [b.minPercent, b.grade, b.gradePoint, b.passing]))
      === JSON.stringify([...bands].sort((a, b) => b.minPercent - a.minPercent).map((b) => [b.minPercent, b.grade, b.gradePoint, b.passing]));
    if (!sameBands && (await this.prisma.exam.count({ where: { gradingSchemeId: id, status: { not: "DRAFT" } } })) > 0) {
      throw unprocessable("An exam already uses this scheme, so its grades can't change. Create a new scheme instead.");
    }
    if (!scheme.isDefault && before.isDefault) throw unprocessable("Make another scheme the default instead of unsetting this one.");
    const row = await this.prisma.$transaction(async (tx) => {
      if (scheme.isDefault) await tx.gradingScheme.updateMany({ where: { ...inInstitute(actor), isDefault: true, NOT: { id } }, data: { isDefault: false } });
      if (!sameBands) {
        await tx.gradeBand.deleteMany({ where: { schemeId: id } });
        await tx.gradeBand.createMany({ data: bands.map((b) => ({ ...b, schemeId: id })) });
      }
      return tx.gradingScheme.update({ where: { id }, data: scheme, include: withBands });
    });
    await this.audit.record(actor.userId, "GRADING_SCHEME_EDIT", "GradingScheme", id, row.name, {
      ip, diff: sameBands ? null : { before: { bands: before.bands.map((b) => `${b.grade}>=${b.minPercent}`) }, after: { bands: bands.map((b) => `${b.grade}>=${b.minPercent}`) } },
    });
    return row;
  }
}
