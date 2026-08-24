import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import { MailService } from "@/common/mail.service";
import { SEMESTER_CURRENT } from "@/common/constants";
import { log, errMessage } from "@/common/logger";
import { conflict, misconfigured, notFound, upstreamFailed } from "@/common/errors/app-error";
import { assertPaymentToken } from "./payment-token";

export const krw = (n: number) => `₩${n.toLocaleString("en-US")}`;

const OPEN_STATUSES = ["PENDING", "PENDING_VERIFICATION", "PAID", "VERIFIED"];

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * SEC-3: the BCSK discount is read from the stored application record. It used to arrive
   * as a caller argument fed from a `?bcsk=1` query parameter, which let any applicant pick
   * their own price. There is deliberately **no override parameter** — the only way to
   * change the rate is to change the persisted claim.
   */
  async computeFee(app: {
    type: string;
    grade: string | null;
    courseName: string | null;
    isBcskStudent?: boolean;
  }): Promise<{ amount: number; breakdown: string }> {
    const isBcsk = app.isBcskStudent === true;

    if (app.type === "REGULAR" || app.type === "RE_ADMISSION") {
      const key = (app.grade ?? "").toLowerCase();
      const fee = await this.prisma.feeConfig.findUnique({ where: { key } });
      if (!fee) throw notFound(`Fee configuration for ${app.grade}`);
      if (app.type === "RE_ADMISSION") {
        return {
          amount: fee.semesterFee,
          breakdown: `Semester fee ${krw(fee.semesterFee)} (admission fee waived for re-admission)`,
        };
      }
      return {
        amount: fee.admissionFee + fee.semesterFee,
        breakdown: `Admission fee ${krw(fee.admissionFee)} + Semester fee ${krw(fee.semesterFee)}`,
      };
    }

    const slugToKey: Record<string, string> = {
      "ielts-for-kids": "ielts_for_kids",
      abacus: "abacus",
      deen: "deen",
      hifz: "hifz",
      "debate-club": "debate_club",
      "bangla-language": "bangla_language",
    };
    const key = slugToKey[app.courseName ?? ""] ?? app.courseName ?? "";
    const fee = await this.prisma.feeConfig.findUnique({ where: { key } });
    if (!fee) throw notFound(`Fee configuration for ${app.courseName}`);
    const course = isBcsk ? (fee.bcskPrice ?? 0) : (fee.nonBcskPrice ?? 0);
    return {
      amount: fee.admissionFee + course,
      breakdown: `Admission fee ${krw(fee.admissionFee)} + Course fee ${krw(course)} (${isBcsk ? "BCSK" : "non-BCSK"} student rate)`,
    };
  }

  newVirtualRef(): string {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `BCSK-VR-${ymd}-${randomBytes(3).toString("hex").toUpperCase()}`;
  }

  /** SEC-7: the payment step is bound to a capability token, not a guessable id. */
  private async loadPayable(applicationId: number, token: string) {
    await assertPaymentToken(token, applicationId);
    const app = await this.prisma.applicationForm.findUnique({
      where: { id: applicationId },
      include: { payments: true },
    });
    if (!app) throw notFound("Application");
    return app;
  }

  async quote(applicationId: number, token: string) {
    const app = await this.loadPayable(applicationId, token);
    const fee = await this.computeFee(app);
    return { applicationId, applicantName: app.applicantName, ...fee };
  }

  async createCardOrder(applicationId: number, token: string) {
    const app = await this.loadPayable(applicationId, token);
    if (app.payments.some((p) => OPEN_STATUSES.includes(p.status))) {
      throw conflict("A payment for this application is already in progress.");
    }
    const fee = await this.computeFee(app);
    const orderId = `BCSK-${applicationId}-${randomBytes(6).toString("hex")}`;
    await this.prisma.payment.create({
      data: {
        applicationId,
        purpose: app.type === "REGULAR" ? "ADMISSION" : "SPECIAL_COURSE",
        method: "CARD",
        amount: fee.amount,
        status: "PENDING",
        gatewayOrderId: orderId,
      },
    });
    log.info("payment", "card_order_created", { applicationId, orderId, amount: fee.amount });
    return { orderId, amount: fee.amount };
  }

  async submitBankTransfer(applicationId: number, token: string, receiptPath: string) {
    const app = await this.loadPayable(applicationId, token);
    if (app.payments.some((p) => OPEN_STATUSES.includes(p.status))) {
      throw conflict("We already have a payment on file for this application.");
    }
    const fee = await this.computeFee(app);
    const virtualRef = this.newVirtualRef();

    // One event, one transaction.
    await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          applicationId,
          purpose: app.type === "REGULAR" ? "ADMISSION" : "SPECIAL_COURSE",
          method: "BANK_TRANSFER",
          amount: fee.amount,
          status: "PENDING_VERIFICATION",
          virtualRef,
          receiptUploadUrl: receiptPath,
        },
      }),
      this.prisma.applicationForm.update({
        where: { id: applicationId },
        data: { status: "PENDING_VERIFICATION" },
      }),
    ]);
    log.info("payment", "bank_transfer_submitted", { applicationId, virtualRef, amount: fee.amount });

    if (app.email) {
      await this.mail.send(
        app.email,
        "BCSK application received — payment under verification",
        this.mail.layout(
          "We received your application",
          `<p style="font-size:14px;color:#232323">Thank you! The application for <b>${app.applicantName}</b> and your bank-transfer receipt are with our office.</p>
           <p style="font-size:14px;color:#232323">Reference: <b>${virtualRef}</b></p>
           <p style="font-size:14px;color:#232323">Our office verifies transfers within 1-2 working days.</p>`,
        ),
      );
    }
    return { virtualRef, amount: fee.amount };
  }

  /* ---------------------------- Toss gateway ---------------------------- */

  tossConfig() {
    const clientKey = process.env.TOSS_CLIENT_KEY?.trim() ?? "";
    const secretKey = process.env.TOSS_SECRET_KEY?.trim() ?? "";
    return { clientKey, secretKey, configured: clientKey.length > 0 && secretKey.length > 0 };
  }

  /**
   * SEC-2.1: a misconfigured gateway is our fault, not a declined card. The two must never
   * be conflated — a config error recorded as a decline tells the office a paying family
   * failed to pay while their money may sit captured at the gateway.
   */
  async confirmToss(paymentKey: string, orderId: string, amount: number) {
    const { secretKey } = this.tossConfig();
    if (!secretKey) {
      log.error("config", "toss_secret_key_missing", { orderId });
      throw misconfigured("TOSS_SECRET_KEY is not set, so card payments cannot be confirmed.");
    }
    log.info("payment", "toss_confirm_requested", { orderId, amount });

    let res: Response;
    try {
      res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": orderId,
        },
        body: JSON.stringify({ paymentKey, orderId, amount }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      log.error("payment", "toss_confirm_unreachable", { orderId, error: errMessage(e) });
      throw misconfigured(`Could not reach the payment gateway: ${errMessage(e)}`);
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const code = typeof data.code === "string" ? data.code : `HTTP_${res.status}`;
      // 401/403 mean *our* credentials are wrong, not that the card failed.
      if (res.status === 401 || res.status === 403) {
        log.error("payment", "toss_auth_rejected", { orderId, status: res.status, code });
        throw misconfigured(`The payment gateway rejected our credentials (${code}).`);
      }
      const message = typeof data.message === "string" ? data.message : `Payment declined (${res.status})`;
      log.warn("payment", "toss_confirm_declined", { orderId, status: res.status, code });
      throw upstreamFailed("The payment gateway", message);
    }

    const okData = data as unknown as {
      paymentKey: string;
      orderId: string;
      totalAmount: number;
      status: string;
    };
    log.info("payment", "toss_confirm_succeeded", {
      orderId,
      amount: okData.totalAmount,
      status: okData.status,
    });
    return okData;
  }

  /**
   * SEC-7.1: safe to replay. Answers from stored state without calling the gateway again,
   * and the unique index on gatewayTxnId collapses a concurrent duplicate.
   */
  async settleCardPayment(paymentKey: string, orderId: string, amount: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { gatewayOrderId: orderId },
      include: { application: true },
    });
    if (!payment?.applicationId) throw notFound("Payment order");

    if (["PAID", "VERIFIED", "REFUNDED"].includes(payment.status)) {
      log.info("payment", "confirm_replayed", { paymentId: payment.id, orderId, status: payment.status });
      return { applicationId: payment.applicationId, replayed: true };
    }
    if (payment.status === "FAILED") {
      throw conflict("This payment did not complete. Please start a new one.");
    }
    if (payment.amount !== amount) {
      log.error("payment", "confirm_amount_mismatch", {
        paymentId: payment.id,
        expected: payment.amount,
        received: amount,
      });
      throw conflict("Payment amount does not match our record.");
    }

    try {
      const confirmed = await this.confirmToss(paymentKey, orderId, amount);
      await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { status: "PAID", gatewayTxnId: confirmed.paymentKey },
        }),
        this.prisma.applicationForm.update({
          where: { id: payment.applicationId },
          data: { status: "PAID" },
        }),
      ]);
      log.info("payment", "confirmed", {
        paymentId: payment.id,
        applicationId: payment.applicationId,
        amount,
      });
      return { applicationId: payment.applicationId, replayed: false };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        // A concurrent request already recorded this capture — the payment succeeded.
        log.info("payment", "confirm_duplicate_collapsed", { paymentId: payment.id, orderId });
        return { applicationId: payment.applicationId, replayed: true };
      }
      // A configuration failure must leave the row PENDING for reconciliation.
      const isConfig = e instanceof Error && e.name === "AppError" && "code" in e && e.code === "MISCONFIGURED";
      if (!isConfig) {
        await this.prisma.payment.updateMany({
          where: { id: payment.id, status: "PENDING" },
          data: { status: "FAILED", rejectReason: errMessage(e) },
        });
      }
      throw e;
    }
  }

  /* -------------------------- Staff operations -------------------------- */

  /**
   * The payments ledger the admin table renders.
   *
   * The relations are selected field-by-field rather than included wholesale: `payer` and
   * `verifiedBy` are `User` rows, and `include: true` shipped every column of them —
   * `passwordHash` included — to the browser-facing tier. The table needs three names and
   * an application id, so that is what it gets.
   */
  async listForStaff() {
    return this.prisma.payment.findMany({
      include: {
        application: { select: { id: true, applicantName: true } },
        payer: { select: { name: true } },
        verifiedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async listForStudent(studentUserId: number) {
    // BUG-1: admission payments predate the student account, so they are linked through
    // the application rather than payerUserId.
    return this.prisma.payment.findMany({
      where: {
        OR: [
          { payerUserId: studentUserId },
          { application: { createdStudentUserId: studentUserId } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Generate the next Student ID. Called inside the activation transaction. */
  async nextStudentId(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `BCSK-${year}-`;
    const last = await tx.studentProfile.findFirst({
      where: { studentId: { startsWith: prefix } },
      orderBy: { studentId: "desc" },
    });
    const n = last ? Number(last.studentId.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(4, "0")}`;
  }

  /**
   * BUG-2: user, profile, enrolments, payment adoption and application status commit
   * together or not at all. BUG-1: the new account adopts its application's payments
   * inside that same transaction.
   */
  async activateEnrolment(applicationId: number): Promise<{ studentId: string }> {
    const app = await this.prisma.applicationForm.findUnique({ where: { id: applicationId } });
    if (!app) throw notFound("Application");

    if (app.createdStudentUserId) {
      const existing = await this.prisma.studentProfile.findFirst({
        where: { userId: app.createdStudentUserId },
      });
      log.info("activation", "already_active", {
        applicationId,
        studentUserId: app.createdStudentUserId,
      });
      return { studentId: existing?.studentId ?? "already-active" };
    }

    const tempPassword = randomBytes(9).toString("base64url");
    const hash = await bcrypt.hash(tempPassword, 12);

    let sessionIds: number[] = [];
    if (app.type === "REGULAR" && app.grade) {
      const sessions = await this.prisma.classSession.findMany({
        where: { classLevel: app.grade, semester: SEMESTER_CURRENT, active: true },
        select: { id: true },
      });
      sessionIds = sessions.map((s) => s.id);
    } else if (app.type === "SPECIAL" && app.courseName) {
      const course = await this.prisma.course.findUnique({ where: { slug: app.courseName } });
      if (course) {
        const session = await this.prisma.classSession.findFirst({
          where: { courseId: course.id, semester: SEMESTER_CURRENT, active: true },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        if (session) sessionIds = [session.id];
      }
    }

    const studentId = await this.prisma.$transaction(async (tx) => {
      const id = await this.nextStudentId(tx);
      const user = await tx.user.create({
        data: {
          loginId: id,
          name: app.applicantName,
          email: app.email,
          passwordHash: hash,
          role: "STUDENT",
          mustChangePassword: true, // SEC-2
          studentProfile: {
            create: {
              studentId: id,
              classLevel: app.type === "SPECIAL" ? "SPECIAL" : (app.grade ?? "PRE_PRIMARY"),
              photoUrl: app.photoUrl,
              dob: app.dob,
              gender: app.gender,
              religion: app.religion,
              fatherName: app.fatherName,
              motherName: app.motherName,
              guardianProfession: app.guardianProfession,
              guardianEducation: app.guardianEducation,
              guardianPhone: app.phone,
              guardianEmail: app.email,
              addressKorea: app.addressKorea,
              addressBangladesh: app.addressBangladesh,
              emergencyContact: app.emergencyContact,
            },
          },
        },
      });
      if (sessionIds.length > 0) {
        await tx.enrollment.createMany({
          data: sessionIds.map((classSessionId) => ({
            studentUserId: user.id,
            classSessionId,
            semester: SEMESTER_CURRENT,
          })),
          skipDuplicates: true,
        });
      }
      await tx.payment.updateMany({
        where: { applicationId: app.id, payerUserId: null },
        data: { payerUserId: user.id },
      });
      await tx.applicationForm.update({
        where: { id: app.id },
        data: { status: "APPROVED", createdStudentUserId: user.id },
      });
      return id;
    });

    log.info("activation", "succeeded", { applicationId, studentId, enrolments: sessionIds.length });

    // Outside the transaction and non-fatal: an SMTP outage must not cost an enrolment.
    if (app.email) {
      await this.mail.send(
        app.email,
        "BCSK Admission Confirmed — Classroom login details",
        this.mail.layout(
          "Welcome to BCSK!",
          `<p style="font-size:14px;color:#232323">The admission for <b>${app.applicantName}</b> is confirmed.</p>
           <table style="font-size:14px;color:#232323;margin:12px 0">
             <tr><td style="padding:4px 12px 4px 0;color:#5b5b6b">Student ID</td><td><b>${studentId}</b></td></tr>
             <tr><td style="padding:4px 12px 4px 0;color:#5b5b6b">Temporary password</td><td><b>${tempPassword}</b></td></tr>
           </table>
           <p style="font-size:12px;color:#5b5b6b">You'll be asked to choose your own password at first sign-in.</p>`,
        ),
      );
    }
    return { studentId };
  }
}
