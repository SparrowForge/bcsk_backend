import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import { toPage, toPrismaPage, type PageRequest } from "../../common/pagination/cursor";
import { ADMIN_ROLES, SEMESTER_CURRENT } from "../../common/constants";
import type { Actor } from "../../common/actor";
import { log } from "../../common/logger";
import {
  LEAD_STAGES, TERMINAL_STAGES,
  type CreateLeadInput, type LeadStage, type PublicEnquiryInput, type UpdateLeadInput,
  activitySchema, activityUpdateSchema, assignSchema, bulkAssignSchema, convertSchema,
  funnelQuery, listLeadsQuery, stageSchema,
} from "./leads.schema";
import { STAGE_SCORE, formatLeadNo, leadNoPrefix, stageMoveError, toDate } from "./leads.rules";

type ListQuery = z.infer<typeof listLeadsQuery>;
type StageInput = z.infer<typeof stageSchema>;
type AssignInput = z.infer<typeof assignSchema>;
type BulkAssignInput = z.infer<typeof bulkAssignSchema>;
type ConvertInput = z.infer<typeof convertSchema>;
type ActivityInput = z.infer<typeof activitySchema>;
type ActivityUpdate = z.infer<typeof activityUpdateSchema>;
type FunnelQuery = z.infer<typeof funnelQuery>;

const closedStages: string[] = [...TERMINAL_STAGES];

/** The relations a lead card needs. Narrow on purpose: never include a whole User row. */
const leadInclude = {
  source: { select: { id: true, name: true } },
  course: { select: { id: true, name: true, slug: true, type: true } },
  assignedTo: { select: { id: true, name: true, loginId: true } },
  convertedApplication: { select: { id: true, status: true } },
} satisfies Prisma.LeadInclude;

const normEmail = (e?: string | null) => (e ? e.trim().toLowerCase() : null);

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* --------------------------------- create --------------------------------- */

  async create(input: CreateLeadInput, actor: Actor) {
    const dup = await this.findDuplicate(input.email, input.phone);
    if (dup) {
      throw conflict(`An open lead already exists for this contact (${dup.leadNo}). Update that lead instead.`, {
        leadId: dup.id,
      });
    }
    const stage = (input.stage ?? "NEW") as LeadStage;
    if (stage === "ENROLLED") throw unprocessable("A lead becomes enrolled by being converted to an application.");
    if (stage === "LOST") throw unprocessable("Create the lead first, then mark it lost with a reason.");
    const owner = await this.assertAssignable(input.assignedToUserId ?? null);
    const lead = await this.saveWithLeadNo({
      name: input.name,
      email: normEmail(input.email),
      phone: input.phone ?? null,
      alternatePhone: input.alternatePhone ?? null,
      gender: input.gender ?? null,
      city: input.city ?? null,
      sourceId: input.sourceId ?? null,
      campaign: input.campaign ?? null,
      referredBy: input.referredBy ?? null,
      courseId: input.courseId ?? null,
      remarks: input.remarks ?? null,
      assignedToUserId: owner?.id ?? null,
      nextFollowUpAt: toDate(input.nextFollowUpAt) ?? null,
      stage,
      score: STAGE_SCORE[stage],
    });
    await this.system(lead.id, "NOTE", "Lead created", { by: actor.userId });
    await this.audit.record(actor.userId, "LEAD_CREATE", "Lead", lead.id, lead.leadNo);
    return this.one(lead.id);
  }

  /**
   * Web-to-lead. A repeat enquiry is acknowledged like any other and logged on the existing
   * lead, so the public form cannot be used to probe which addresses are on file.
   */
  async createFromPublicForm(input: PublicEnquiryInput) {
    const dup = await this.findDuplicate(input.email, input.phone);
    if (dup) {
      await this.system(dup.id, "NOTE", "Repeat enquiry received from the public form", { notes: input.message });
      return null;
    }
    // A source that is not public is ignored rather than rejected, so source ids cannot be probed.
    const source = input.sourceId
      ? await this.prisma.leadSource.findFirst({ where: { id: input.sourceId, isPublic: true, active: true } })
      : null;
    const course = input.courseId
      ? await this.prisma.course.findFirst({ where: { id: input.courseId, active: true }, select: { id: true } })
      : null;
    const lead = await this.saveWithLeadNo({
      name: input.name,
      email: normEmail(input.email),
      phone: input.phone ?? null,
      city: input.city ?? null,
      sourceId: source?.id ?? null,
      courseId: course?.id ?? null,
      remarks: input.message ?? null,
      stage: "NEW",
      score: STAGE_SCORE.NEW,
    });
    await this.system(lead.id, "NOTE", "Lead captured from the public enquiry form", { notes: input.message });
    log.info("crm", "public_enquiry", { leadId: lead.id });
    return lead;
  }

  /* ---------------------------------- read ---------------------------------- */

  async list(q: ListQuery) {
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...(q.stage && { stage: q.stage }),
      ...(q.sourceId && { sourceId: q.sourceId }),
      ...(q.courseId && { courseId: q.courseId }),
      ...(q.assignedToUserId && { assignedToUserId: q.assignedToUserId }),
      ...(q.unassigned && { assignedToUserId: null }),
      ...(q.followUpDue && { nextFollowUpAt: { lte: new Date() }, stage: { notIn: closedStages } }),
      ...(q.search && {
        OR: [
          { name: { contains: q.search, mode: "insensitive" } },
          { email: { contains: q.search, mode: "insensitive" } },
          { phone: { contains: q.search } },
          { leadNo: { contains: q.search, mode: "insensitive" } },
        ],
      }),
    };
    const req: PageRequest = { cursor: q.cursor, limit: q.limit };
    const rows = await this.prisma.lead.findMany({
      where, include: leadInclude, orderBy: { id: "desc" }, ...toPrismaPage(req),
    });
    return toPage(rows, req);
  }

  /** Leads for the pipeline board. Capped: the board is for working leads, not archives. */
  board() {
    return this.prisma.lead.findMany({
      where: { deletedAt: null },
      include: leadInclude,
      orderBy: [{ nextFollowUpAt: { sort: "asc", nulls: "last" } }, { id: "desc" }],
      take: 500,
    });
  }

  async one(id: number) {
    const lead = await this.prisma.lead.findFirst({ where: { id, deletedAt: null }, include: leadInclude });
    if (!lead) throw notFound("Lead");
    return lead;
  }

  /** The existing open lead for the same email or phone. Closed leads do not count. */
  async findDuplicate(email?: string | null, phone?: string | null) {
    const e = normEmail(email);
    const or: Prisma.LeadWhereInput[] = [];
    if (e) or.push({ email: { equals: e, mode: "insensitive" } });
    if (phone) or.push({ phone });
    if (or.length === 0) return null;
    return this.prisma.lead.findFirst({
      where: { deletedAt: null, stage: { notIn: closedStages }, OR: or },
      select: { id: true, leadNo: true, name: true, stage: true },
    });
  }

  /* --------------------------------- update --------------------------------- */

  async update(id: number, input: UpdateLeadInput, actor: Actor) {
    const lead = await this.one(id);
    if (lead.stage === "ENROLLED") throw unprocessable("This lead has been converted and can no longer be edited.");
    await this.prisma.lead.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.email !== undefined && { email: normEmail(input.email) }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.alternatePhone !== undefined && { alternatePhone: input.alternatePhone }),
        ...(input.gender !== undefined && { gender: input.gender }),
        ...(input.city !== undefined && { city: input.city }),
        ...(input.sourceId !== undefined && { sourceId: input.sourceId }),
        ...(input.campaign !== undefined && { campaign: input.campaign }),
        ...(input.referredBy !== undefined && { referredBy: input.referredBy }),
        ...(input.courseId !== undefined && { courseId: input.courseId }),
        ...(input.remarks !== undefined && { remarks: input.remarks }),
        ...(input.nextFollowUpAt !== undefined && { nextFollowUpAt: toDate(input.nextFollowUpAt) }),
      },
    });
    await this.audit.record(actor.userId, "LEAD_EDIT", "Lead", id);
    return this.one(id);
  }

  async setStage(id: number, input: StageInput, actor: Actor) {
    const lead = await this.one(id);
    const from = lead.stage as LeadStage;
    const problem = stageMoveError(from, input.stage);
    if (problem) throw unprocessable(problem);
    if (input.stage === "LOST" && !input.lostReason) throw unprocessable("Choose why the lead was lost.");

    const lost = input.stage === "LOST";
    await this.prisma.lead.update({
      where: { id },
      data: {
        stage: input.stage,
        score: STAGE_SCORE[input.stage],
        lostReason: lost ? input.lostReason : null,
        lostNote: lost ? input.lostNote ?? null : null,
        // A closed lead is never chased: clear any pending follow-up.
        nextFollowUpAt: lost ? null : input.nextFollowUpAt !== undefined ? toDate(input.nextFollowUpAt) : undefined,
      },
    });
    await this.system(id, "STAGE_CHANGE", `Stage changed from ${from} to ${input.stage}`, {
      notes: input.note, by: actor.userId,
    });
    await this.audit.record(actor.userId, "LEAD_STAGE", "Lead", id, `${from} -> ${input.stage}`);
    return this.one(id);
  }

  async assign(id: number, input: AssignInput, actor: Actor) {
    const lead = await this.one(id);
    const owner = await this.assertAssignable(input.assignedToUserId);
    await this.prisma.lead.update({
      where: { id },
      data: {
        assignedToUserId: input.assignedToUserId,
        ...(input.nextFollowUpAt !== undefined && { nextFollowUpAt: toDate(input.nextFollowUpAt) }),
      },
    });
    await this.system(id, "ASSIGNMENT", owner ? `Assigned to ${owner.name}` : "Assignment cleared", {
      notes: input.note ?? (lead.assignedTo ? `Previously assigned to ${lead.assignedTo.name}` : null),
      by: actor.userId,
    });
    return this.one(id);
  }

  async bulkAssign(input: BulkAssignInput, actor: Actor) {
    const owner = await this.assertAssignable(input.assignedToUserId);
    const leads = await this.prisma.lead.findMany({
      where: { id: { in: input.leadIds }, deletedAt: null }, select: { id: true },
    });
    if (leads.length === 0) throw notFound("Leads");
    const ids = leads.map((l) => l.id);
    await this.prisma.$transaction([
      this.prisma.lead.updateMany({ where: { id: { in: ids } }, data: { assignedToUserId: input.assignedToUserId } }),
      this.prisma.leadActivity.createMany({
        data: ids.map((leadId) => ({
          leadId, type: "ASSIGNMENT", isSystemGenerated: true, completedAt: new Date(), performedByUserId: actor.userId,
          subject: owner ? `Bulk assigned to ${owner.name}` : "Assignment cleared in bulk update",
        })),
      }),
    ]);
    await this.audit.record(actor.userId, "LEAD_BULK_ASSIGN", "Lead", undefined, `${ids.length} leads`);
    return { updated: ids.length };
  }

  /**
   * Turns a lead into a prefilled admission application, linked back to the lead. The
   * application enters the normal admissions flow (payment, review, approval); the lead is
   * kept as ENROLLED so funnel reporting stays intact. One transaction: both happen or neither.
   */
  async convert(id: number, input: ConvertInput, actor: Actor) {
    const lead = await this.one(id);
    if (lead.convertedApplicationId) {
      throw conflict(`${lead.leadNo} was already converted to application #${lead.convertedApplicationId}.`);
    }
    if (lead.stage === "LOST") throw unprocessable("A lost lead cannot be converted. Move it back into the pipeline first.");

    const type = input.type ?? (lead.course?.type === "SPECIAL" ? "SPECIAL" : "REGULAR");
    let courseName: string | null = null;
    let grade: string | null = null;
    let courseLevelId: number | null = null;

    if (type === "SPECIAL") {
      if (lead.course?.type !== "SPECIAL") throw unprocessable("Set a special course on the lead before converting.");
      courseName = lead.course.slug;
      if (input.courseLevelId) {
        const level = await this.prisma.courseLevel.findFirst({
          where: { id: input.courseLevelId, courseId: lead.course.id },
        });
        if (!level) throw unprocessable("That level does not belong to the lead's course.");
        courseLevelId = level.id;
      }
    } else {
      if (!input.courseLevelId) throw unprocessable("Choose the class the student is applying for.");
      const level = await this.prisma.courseLevel.findFirst({
        where: { id: input.courseLevelId, course: { slug: "regular-course" } },
      });
      if (!level?.code) throw unprocessable("Choose a class of the Regular Course.");
      courseLevelId = level.id;
      grade = level.code;
    }

    const application = await this.prisma.$transaction(async (tx) => {
      const app = await tx.applicationForm.create({
        data: {
          type,
          applicantName: lead.name,
          phone: lead.phone,
          email: lead.email,
          gender: lead.gender,
          semester: SEMESTER_CURRENT,
          grade,
          courseName,
          courseLevelId,
          parentalConsent: false,
          adminNote: `Created from CRM lead ${lead.leadNo} - the family still has to complete consent and payment.`,
        },
      });
      await tx.lead.update({
        where: { id },
        data: {
          stage: "ENROLLED", score: STAGE_SCORE.ENROLLED, convertedApplicationId: app.id, convertedAt: new Date(),
          nextFollowUpAt: null, lostReason: null, lostNote: null,
        },
      });
      await tx.leadActivity.create({
        data: {
          leadId: id, type: "STAGE_CHANGE", isSystemGenerated: true, completedAt: new Date(),
          performedByUserId: actor.userId, subject: `Converted to application #${app.id}`, notes: input.note ?? null,
        },
      });
      return app;
    });
    await this.audit.record(actor.userId, "LEAD_CONVERT", "Lead", id, `application ${application.id}`);
    return { lead: await this.one(id), applicationId: application.id };
  }

  async remove(id: number, actor: Actor) {
    const lead = await this.one(id);
    if (lead.convertedApplicationId) {
      throw unprocessable("A converted lead cannot be deleted: it is part of the admissions record.");
    }
    await this.prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record(actor.userId, "LEAD_DELETE", "Lead", id, lead.leadNo);
    return { ok: true };
  }

  async restore(id: number, actor: Actor) {
    const lead = await this.prisma.lead.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!lead) throw notFound("Lead");
    if (!lead.deletedAt) throw unprocessable("This lead is not deleted.");
    await this.prisma.lead.update({ where: { id }, data: { deletedAt: null } });
    await this.audit.record(actor.userId, "LEAD_RESTORE", "Lead", id);
    return this.one(id);
  }

  /* ------------------------------- activities ------------------------------- */

  async activities(leadId: number) {
    await this.one(leadId);
    return this.prisma.leadActivity.findMany({
      where: { leadId, deletedAt: null },
      include: { performedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async logActivity(leadId: number, input: ActivityInput, actor: Actor) {
    const lead = await this.one(leadId);
    if (lead.stage === "ENROLLED") {
      throw unprocessable("This lead has been converted; log the follow-up on the application instead.");
    }
    const completedAt = toDate(input.completedAt);
    const activity = await this.prisma.leadActivity.create({
      data: {
        leadId, type: input.type, subject: input.subject, notes: input.notes ?? null,
        outcome: input.outcome ?? null, scheduledAt: toDate(input.scheduledAt) ?? null,
        completedAt: completedAt ?? null, performedByUserId: actor.userId, isSystemGenerated: false,
      },
    });
    // Logging an interaction counts as contact, and may set the next follow-up.
    const touch: Prisma.LeadUpdateInput = {};
    if (completedAt) touch.lastContactedAt = completedAt;
    if (input.nextFollowUpAt !== undefined) touch.nextFollowUpAt = toDate(input.nextFollowUpAt);
    if (Object.keys(touch).length) await this.prisma.lead.update({ where: { id: leadId }, data: touch });
    return activity;
  }

  async updateActivity(activityId: number, input: ActivityUpdate) {
    const a = await this.prisma.leadActivity.findFirst({ where: { id: activityId, deletedAt: null } });
    if (!a) throw notFound("Activity");
    if (a.isSystemGenerated) throw unprocessable("System entries are a record and cannot be edited.");
    return this.prisma.leadActivity.update({
      where: { id: activityId },
      data: {
        ...(input.type !== undefined && { type: input.type }),
        ...(input.subject !== undefined && { subject: input.subject }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.outcome !== undefined && { outcome: input.outcome }),
        ...(input.scheduledAt !== undefined && { scheduledAt: toDate(input.scheduledAt) }),
        ...(input.completedAt !== undefined && { completedAt: toDate(input.completedAt) }),
      },
    });
  }

  async removeActivity(activityId: number) {
    const a = await this.prisma.leadActivity.findFirst({ where: { id: activityId, deletedAt: null } });
    if (!a) throw notFound("Activity");
    if (a.isSystemGenerated) throw unprocessable("System entries are a record and cannot be deleted.");
    await this.prisma.leadActivity.update({ where: { id: activityId }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /** Scheduled activities that are due and not yet done: the counsellor's task list. */
  dueActivities(userId?: number) {
    return this.prisma.leadActivity.findMany({
      where: {
        deletedAt: null, completedAt: null, scheduledAt: { not: null, lte: new Date() },
        lead: { deletedAt: null },
        ...(userId && { performedByUserId: userId }),
      },
      include: { lead: { select: { id: true, leadNo: true, name: true, phone: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 200,
    });
  }

  /** Open leads whose follow-up date has passed. */
  dueFollowUps(assignedToUserId?: number) {
    return this.prisma.lead.findMany({
      where: {
        deletedAt: null, nextFollowUpAt: { not: null, lte: new Date() }, stage: { notIn: closedStages },
        ...(assignedToUserId && { assignedToUserId }),
      },
      include: leadInclude,
      orderBy: { nextFollowUpAt: "asc" },
      take: 200,
    });
  }

  /* -------------------------------- reporting -------------------------------- */

  async funnel(q: FunnelQuery) {
    const where: Prisma.LeadWhereInput = {
      deletedAt: null,
      ...(q.courseId && { courseId: q.courseId }),
      ...((q.from || q.to) && {
        createdAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) },
      }),
    };
    const [stageRows, sourceRows, lostRows, sources] = await Promise.all([
      this.prisma.lead.groupBy({ by: ["stage"], where, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ["sourceId", "stage"], where, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ["lostReason"], where: { ...where, stage: "LOST" }, _count: { _all: true } }),
      this.prisma.leadSource.findMany({ select: { id: true, name: true } }),
    ]);
    const byStage = LEAD_STAGES.map((stage) => ({
      stage, count: stageRows.find((r) => r.stage === stage)?._count._all ?? 0,
    }));
    const total = byStage.reduce((s, r) => s + r.count, 0);
    const enrolled = byStage.find((r) => r.stage === "ENROLLED")?.count ?? 0;
    const lost = byStage.find((r) => r.stage === "LOST")?.count ?? 0;

    type SourceRow = { sourceId: number | null; sourceName: string; count: number; enrolled: number };
    const bySource = new Map<number | null, SourceRow>();
    for (const r of sourceRows) {
      const cur = bySource.get(r.sourceId) ?? {
        sourceId: r.sourceId,
        sourceName: sources.find((s) => s.id === r.sourceId)?.name ?? "Unattributed",
        count: 0,
        enrolled: 0,
      };
      cur.count += r._count._all;
      if (r.stage === "ENROLLED") cur.enrolled += r._count._all;
      bySource.set(r.sourceId, cur);
    }
    return {
      byStage,
      bySource: [...bySource.values()].sort((a, b) => b.count - a.count),
      lostReasons: lostRows.map((r) => ({ reason: r.lostReason ?? "OTHER", count: r._count._all })),
      total, enrolled, lost, open: total - enrolled - lost,
      conversionRate: total === 0 ? 0 : Math.round((enrolled / total) * 10000) / 100,
    };
  }

  /** Staff who can own a lead: any admin-role account that is still active. */
  assignees() {
    return this.prisma.user.findMany({
      where: { role: { in: ADMIN_ROLES }, active: true },
      select: { id: true, name: true, role: true },
      orderBy: { name: "asc" },
    });
  }

  /** Courses and their levels, for the lead form's interest picker and the convert step. */
  courseOptions() {
    return this.prisma.course.findMany({
      where: { active: true },
      select: {
        id: true, name: true, slug: true, type: true,
        levels: { select: { id: true, name: true, code: true }, orderBy: { displayOrder: "asc" } },
      },
      orderBy: [{ type: "asc" }, { displayOrder: "asc" }],
    });
  }

  /* --------------------------------- helpers --------------------------------- */

  private async assertAssignable(userId: number | null) {
    if (userId === null) return null;
    const u = await this.prisma.user.findFirst({
      where: { id: userId, role: { in: ADMIN_ROLES }, active: true }, select: { id: true, name: true },
    });
    if (!u) throw unprocessable("Choose an active staff member.");
    return u;
  }

  /** System-written timeline entry: stage change, assignment, capture. */
  private system(leadId: number, type: string, subject: string, o: { notes?: string | null; by?: number | null } = {}) {
    return this.prisma.leadActivity.create({
      data: {
        leadId, type, subject, notes: o.notes ?? null, completedAt: new Date(),
        performedByUserId: o.by ?? null, isSystemGenerated: true,
      },
    });
  }

  /**
   * leadNo is LD-YYMM-NNNN, derived from a count. Two concurrent creates can pick the same
   * number, so rely on the unique index and retry on P2002, which is also correct across
   * several API instances.
   */
  private async saveWithLeadNo(data: Omit<Prisma.LeadUncheckedCreateInput, "leadNo">) {
    const prefix = leadNoPrefix();
    for (let attempt = 0; ; attempt++) {
      const count = await this.prisma.lead.count({ where: { leadNo: { startsWith: prefix } } });
      try {
        return await this.prisma.lead.create({ data: { ...data, leadNo: formatLeadNo(prefix, count + 1 + attempt) } });
      } catch (e) {
        const clash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
        if (!clash || attempt >= 5) throw e;
      }
    }
  }
}
