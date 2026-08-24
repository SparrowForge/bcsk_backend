import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { certificatePdf, idCardPdf, resultSheetPdf, receiptPdf } from "@/common/pdf";
import { SEMESTER_CURRENT, classLevelLabel } from "@/common/constants";
import { forbidden, notFound, unprocessable } from "@/common/errors/app-error";
import { roleHas } from "@/common/permissions";
import type { Actor } from "@/common/actor";

export type DocumentType = "certificate" | "id-card" | "result-sheet";

/**
 * Generated PDFs: enrolment certificates, ID cards, result sheets and payment receipts.
 *
 * Issuing a document writes a `Certificate` row so the serial can be verified later from the
 * public `/verify/:serial` page — a document that cannot be checked is not much of a document.
 */
@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService) {}

  private async profileFor(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { studentProfile: true },
    });
    if (!user?.studentProfile) throw notFound("Student");
    return { user, profile: user.studentProfile };
  }

  /**
   * Generate a document for a student.
   *
   * `actor` may be the student themselves or staff holding `reports:manage`. Ownership is
   * checked here rather than in the controller, so neither entry point can forget it.
   */
  async generate(actor: Actor, studentUserId: number, type: DocumentType): Promise<{ filename: string; pdf: Buffer }> {
    if (actor.userId !== studentUserId && !roleHas(actor.role, "reports:manage")) {
      throw forbidden();
    }

    const { user, profile } = await this.profileFor(studentUserId);
    const classLabel = classLevelLabel(profile.classLevel);
    const year = new Date().getFullYear();

    if (type === "certificate") {
      const serial = `BCSK-CERT-${year}-${String(studentUserId).padStart(4, "0")}`;
      await this.recordIssue(studentUserId, "ENROLLMENT", serial, {
        name: user.name, studentId: profile.studentId, class: classLabel, semester: SEMESTER_CURRENT,
      });
      return {
        filename: `${serial}.pdf`,
        pdf: await certificatePdf({
          serial, studentName: user.name, studentId: profile.studentId,
          classLevel: classLabel, semester: SEMESTER_CURRENT,
        }),
      };
    }

    if (type === "id-card") {
      const serial = `BCSK-ID-${year}-${String(studentUserId).padStart(4, "0")}`;
      await this.recordIssue(studentUserId, "ID_CARD", serial, {
        name: user.name, studentId: profile.studentId, class: classLabel,
      });
      return {
        filename: `${serial}.pdf`,
        pdf: await idCardPdf({
          serial, studentName: user.name, studentId: profile.studentId, classLevel: classLabel,
          verifyUrl: `${process.env.WEB_BASE_URL ?? ""}/verify/${serial}`,
        }),
      };
    }

    const results = await this.prisma.examResult.findMany({
      where: { studentUserId },
      orderBy: { subject: "asc" },
    });
    if (results.length === 0) throw unprocessable("No results have been published yet.");
    const semester = [...results].map((r) => r.semester).sort().reverse()[0]!;
    const serial = `BCSK-RES-${semester}-${String(studentUserId).padStart(4, "0")}`;
    return {
      filename: `${serial}.pdf`,
      pdf: await resultSheetPdf({
        serial, studentName: user.name, studentId: profile.studentId, classLevel: classLabel,
        semester, rows: results.filter((r) => r.semester === semester),
      }),
    };
  }

  private async recordIssue(studentUserId: number, type: string, serial: string, data: unknown) {
    await this.prisma.certificate.upsert({
      where: { serial },
      update: {},
      create: { studentUserId, type, serial, dataJson: JSON.stringify(data) },
    });
  }

  /** FR-ADM-08: a payment receipt, for the payer or for staff. */
  async receipt(actor: Actor, paymentId: number): Promise<{ filename: string; pdf: Buffer }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { payer: true, application: true },
    });
    if (!payment) throw notFound("Payment");

    // BUG-1: an admission payment is owned both by whoever it was attributed to and by the
    // student account its application created — older rows only have the second link.
    const isOwner =
      payment.payerUserId === actor.userId ||
      payment.application?.createdStudentUserId === actor.userId;
    if (!isOwner && !roleHas(actor.role, "payments:read")) throw forbidden();

    if (!["PAID", "VERIFIED", "REFUNDED"].includes(payment.status)) {
      throw unprocessable("A receipt is available once the payment is confirmed.");
    }

    let serial = payment.receiptPdfSerial;
    if (!serial) {
      serial = `BCSK-RCPT-${new Date().getFullYear()}-${String(payment.id).padStart(4, "0")}`;
      await this.prisma.payment.update({ where: { id: payment.id }, data: { receiptPdfSerial: serial } });
    }

    return {
      filename: `${serial}.pdf`,
      pdf: await receiptPdf({
        serial,
        payerName: payment.payer?.name ?? payment.application?.applicantName ?? "Applicant",
        purpose: payment.purpose,
        method: payment.method,
        amount: payment.amount,
        status: payment.status,
        reference: payment.gatewayTxnId ?? payment.virtualRef,
        date: payment.verifiedAt ?? payment.updatedAt,
      }),
    };
  }

  /** FR-ADMIN-04: the financial report, as CSV. */
  async paymentsCsv(): Promise<string> {
    const payments = await this.prisma.payment.findMany({
      include: { application: true, payer: true, verifiedBy: true },
      orderBy: { createdAt: "asc" },
    });
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [
      ["id", "date", "payer", "purpose", "method", "amount_krw", "status", "reference", "verified_by", "verified_at"].join(","),
      ...payments.map((p) =>
        [
          p.id,
          p.createdAt.toISOString(),
          esc(p.payer?.name ?? p.application?.applicantName ?? ""),
          p.purpose,
          p.method,
          p.amount,
          p.status,
          esc(p.gatewayTxnId ?? p.virtualRef ?? ""),
          esc(p.verifiedBy?.name ?? ""),
          p.verifiedAt?.toISOString() ?? "",
        ].join(","),
      ),
    ].join("\n");
  }

  /** FR-STU-09: public QR verification of an issued serial. */
  async verify(serial: string) {
    const cert = await this.prisma.certificate.findUnique({
      where: { serial },
      include: { student: { include: { studentProfile: true } } },
    });
    if (!cert) return { valid: false as const, serial };
    return {
      valid: true as const,
      serial: cert.serial,
      type: cert.type,
      studentName: cert.student.name,
      studentId: cert.student.studentProfile?.studentId ?? null,
      issuedAt: cert.issuedAt,
    };
  }
}
