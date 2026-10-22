import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import type { Actor } from "../../common/actor";
import { ReportService } from "../result/report.service";
import { randomCode } from "../document/document.service";
import { assertMove, TRANSFER_FLOW } from "./workflow";
import type { TransferInput } from "./application.schema";

const fields = {
  id: true, destination: true, reason: true, effectiveDate: true, status: true, duesCleared: true, libraryCleared: true,
  verifiedAt: true, verifyNote: true, decidedAt: true, decisionNote: true, letterSerial: true, createdAt: true,
  student: { select: { id: true, name: true, studentProfile: { select: { studentId: true, status: true } } } },
} as const;

/**
 * Student transfer: Application -> Verification -> Head Master Approval/Rejection -> Transfer
 * Letter -> Student Record Update.
 *
 *  - A student (with their guardian) applies, naming the school they move to and from when.
 *  - The office (`transfer:verify`, also held by the Head Master) clears dues and library; with
 *    both cleared the application is VERIFIED.
 *  - The Head Master (`transfer:decide`) approves a verified application, or rejects at any stage.
 *  - Approval, in one transaction: the letter is recorded with a verifiable serial, the student's
 *    record becomes TRANSFERRED, their sections and enrolments close. The account stays usable, so
 *    the family can still download the letter.
 */
@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportService,
  ) {}

  private async staffToTell(instituteId: number) {
    return this.prisma.user.findMany({ where: { instituteId, role: { in: ["ADMIN_SUPPORT", "HEAD_MASTER"] }, active: true }, select: { id: true } });
  }

  /* ----------------------------------------------------------------- student */

  async apply(actor: Actor, input: TransferInput) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { userId: actor.userId }, select: { status: true } });
    if (!profile) throw notFound("Student record");
    if (profile.status !== "ACTIVE") throw unprocessable("Your student record is no longer active.");
    const open = await this.prisma.transferApplication.findFirst({ where: { studentUserId: actor.userId, status: { in: ["SUBMITTED", "VERIFIED"] } }, select: { id: true } });
    if (open) throw conflict("You already have a transfer request in progress.");
    const place = await this.prisma.sectionEnrollment.findFirst({
      where: { studentUserId: actor.userId, status: "ACTIVE", batch: { term: { ...inInstitute(actor), isCurrent: true } } },
      select: { sectionId: true },
    });
    const row = await this.prisma.transferApplication.create({
      data: { ...inInstitute(actor), studentUserId: actor.userId, sectionId: place?.sectionId ?? null, ...input },
      select: fields,
    });
    const staff = await this.staffToTell(actor.instituteId);
    if (staff.length) {
      await this.prisma.notification.createMany({
        data: staff.map((s) => ({ userId: s.id, kind: "ADMIN", title: "Transfer request", body: `${actor.name} to ${input.destination}`, link: "/admin/transfers" })),
      });
    }
    return row;
  }

  mine(actor: Actor) {
    return this.prisma.transferApplication.findMany({ where: { studentUserId: actor.userId }, orderBy: { createdAt: "desc" }, select: fields });
  }

  async cancel(actor: Actor, id: number) {
    const row = await this.prisma.transferApplication.findFirst({ where: { id, studentUserId: actor.userId } });
    if (!row) throw notFound("Transfer request");
    assertMove(TRANSFER_FLOW, row.status, "CANCELLED", "transfer request");
    return this.prisma.transferApplication.update({ where: { id }, data: { status: "CANCELLED" }, select: fields });
  }

  /** The student's own transfer letter, once approved. */
  async letter(actor: Actor) {
    const row = await this.prisma.transferApplication.findFirst({
      where: { studentUserId: actor.userId, status: "APPROVED", letterSerial: { not: null } },
      orderBy: { decidedAt: "desc" },
      select: { letterSerial: true },
    });
    if (!row) throw notFound("Transfer letter");
    return this.reports.reprint(actor, row.letterSerial!);
  }

  /* ----------------------------------------------------------------- staff */

  list(actor: Actor, status?: string) {
    return this.prisma.transferApplication.findMany({
      where: { ...inInstitute(actor), ...(status ? { status } : {}) },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 300,
      select: fields,
    });
  }

  private async row(actor: Actor, id: number) {
    const row = await this.prisma.transferApplication.findFirst({ where: { id, ...inInstitute(actor) } });
    if (!row) throw notFound("Transfer request");
    return row;
  }

  /**
   * The office's clearance. Each tick is recorded as it is made; with both dues and library
   * cleared the application moves to VERIFIED and on to the Head Master.
   */
  async verify(actor: Actor, id: number, input: { duesCleared: boolean; libraryCleared: boolean; note: string | null }, ip?: string) {
    const row = await this.row(actor, id);
    if (row.status !== "SUBMITTED") assertMove(TRANSFER_FLOW, row.status, "VERIFIED", "transfer request");
    const complete = input.duesCleared && input.libraryCleared;
    const updated = await this.prisma.transferApplication.update({
      where: { id },
      data: {
        duesCleared: input.duesCleared, libraryCleared: input.libraryCleared, verifyNote: input.note,
        ...(complete ? { status: "VERIFIED", verifiedById: actor.userId, verifiedAt: new Date() } : {}),
      },
      select: fields,
    });
    await this.audit.record(actor.userId, complete ? "TRANSFER_VERIFY" : "TRANSFER_CLEARANCE", "TransferApplication", id, input.note ?? undefined, {
      ip, diff: { before: { duesCleared: row.duesCleared, libraryCleared: row.libraryCleared }, after: { duesCleared: input.duesCleared, libraryCleared: input.libraryCleared } },
    });
    return updated;
  }

  async decide(actor: Actor, id: number, decision: "APPROVE" | "REJECT", note: string | null, ip?: string) {
    const row = await this.row(actor, id);
    const to = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    if (to === "APPROVED" && row.status === "SUBMITTED") throw conflict("The office must clear dues and library before this can be approved.", { from: row.status, to });
    assertMove(TRANSFER_FLOW, row.status, to, "transfer request");
    const now = new Date();

    if (to === "REJECTED") {
      const updated = await this.prisma.transferApplication.update({ where: { id }, data: { status: to, decidedById: actor.userId, decidedAt: now, decisionNote: note }, select: fields });
      await this.prisma.notification.create({ data: { userId: row.studentUserId, kind: "GENERAL", title: "Transfer not approved", body: note ?? "", link: "/classroom/documents" } });
      await this.audit.record(actor.userId, "TRANSFER_REJECT", "TransferApplication", id, note ?? undefined, { ip });
      return updated;
    }

    // The letter's text is fixed now, from the record as it stands before the sections close.
    const { _sectionId, ...values } = await this.reports.values(actor, row.studentUserId, null, null);
    const rendered = await this.reports.render(actor, "TRANSFER_LETTER", "en", {
      ...values, destination: row.destination, reason: row.reason, effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    });
    // The letter's registry row commits with the approval, so a failed approval leaves no letter
    // that would verify.
    const serial = `BCSK-TC-${now.getFullYear()}-${randomCode()}`;
    const [, updated] = await this.prisma.$transaction([
      this.prisma.certificate.create({ data: { studentUserId: row.studentUserId, type: "TRANSFER_LETTER", serial, issuedById: actor.userId, dataJson: JSON.stringify({ ...rendered, lang: "en" }) } }),
      this.prisma.transferApplication.update({ where: { id }, data: { status: to, decidedById: actor.userId, decidedAt: now, decisionNote: note, letterSerial: serial }, select: fields }),
      this.prisma.studentProfile.update({ where: { userId: row.studentUserId }, data: { status: "TRANSFERRED" } }),
      this.prisma.sectionEnrollment.updateMany({ where: { studentUserId: row.studentUserId, status: "ACTIVE" }, data: { status: "TRANSFERRED" } }),
      this.prisma.enrollment.updateMany({ where: { studentUserId: row.studentUserId, status: "ACTIVE" }, data: { status: "CANCELLED" } }),
      this.prisma.notification.create({ data: { userId: row.studentUserId, kind: "GENERAL", title: "Transfer approved", body: "Your transfer letter is ready to download.", link: "/classroom/documents" } }),
    ]);
    await this.audit.record(actor.userId, "TRANSFER_APPROVE", "TransferApplication", id, `letter ${serial}`, {
      ip, diff: { before: { status: row.status, studentStatus: "ACTIVE" }, after: { status: to, studentStatus: "TRANSFERRED" } },
    });
    return updated;
  }
}
