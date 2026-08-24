import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/common/audit.service";
import { MailService } from "@/common/mail.service";
import { RateLimitService } from "@/common/rate-limit.service";
import { verifyRecaptcha } from "@/common/recaptcha";
import { notFound, unprocessable } from "@/common/errors/app-error";
import { toPage, toPrismaPage, type PageRequest } from "@/common/pagination/cursor";
import { log } from "@/common/logger";
import { issuePaymentToken, assertPaymentToken } from "@/modules/payment/payment-token";
import { PaymentService } from "@/modules/payment/payment.service";
import type { Actor } from "@/common/actor";
import type { RegularApplicationInput, SpecialApplicationInput } from "./admission.schema";

/** GAP-12: the specification restricts admission to children aged 5 and above. */
const MINIMUM_AGE_YEARS = 5;

function ageOn(dob: Date, on = new Date()): number {
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age -= 1;
  return age;
}

@Injectable()
export class AdmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly payments: PaymentService,
  ) {}

  private assertEligible(dobRaw: string): Date {
    const dob = new Date(dobRaw);
    if (Number.isNaN(dob.getTime())) throw unprocessable("Enter a valid date of birth.");
    if (ageOn(dob) < MINIMUM_AGE_YEARS) {
      throw unprocessable(`Students must be at least ${MINIMUM_AGE_YEARS} years old to apply.`);
    }
    return dob;
  }

  /**
   * SEC-7: the response carries a signed capability token. It is the only thing that opens
   * the payment step, so an application id on its own is useless to anyone who guesses it.
   */
  private async issued(applicationId: number) {
    return { applicationId, paymentToken: await issuePaymentToken(applicationId) };
  }

  async submitRegular(input: RegularApplicationInput, ip: string) {
    await this.rateLimit.consume("apply", ip);
    const captcha = await verifyRecaptcha(input.recaptchaToken, "apply");
    if (!captcha.ok) throw unprocessable("Captcha verification failed. Please try again.");
    const dob = this.assertEligible(input.dob);

    const app = await this.prisma.applicationForm.create({
      data: {
        type: "REGULAR",
        applicantName: input.applicantName,
        dob,
        gender: input.gender,
        religion: input.religion,
        phone: input.phone,
        email: input.email,
        photoUrl: input.photoPath,
        addressKorea: input.addressKorea,
        addressBangladesh: input.addressBangladesh,
        emergencyContact: input.emergencyContact,
        grade: input.grade,
        fatherName: input.fatherName,
        motherName: input.motherName,
        guardianProfession: input.guardianProfession || null,
        guardianEducation: input.guardianEducation || null,
        guardianPhone2: input.guardianPhone2 || null,
        parentalConsent: true,
      },
    });
    log.info("activation", "application_submitted", { applicationId: app.id, type: "REGULAR" });
    return this.issued(app.id);
  }

  async submitSpecial(input: SpecialApplicationInput, ip: string) {
    await this.rateLimit.consume("apply", ip);
    const captcha = await verifyRecaptcha(input.recaptchaToken, "apply");
    if (!captcha.ok) throw unprocessable("Captcha verification failed. Please try again.");
    const dob = this.assertEligible(input.dob);

    const app = await this.prisma.applicationForm.create({
      data: {
        type: "SPECIAL",
        applicantName: input.applicantName,
        dob,
        gender: input.gender,
        religion: input.religion,
        phone: input.phone,
        email: input.email,
        photoUrl: input.photoPath,
        addressKorea: input.addressKorea || null,
        addressBangladesh: input.addressBangladesh,
        emergencyContact: input.emergencyContact,
        courseName: input.courseName,
        highestEducation: input.highestEducation || null,
        parentalConsent: true,
        // SEC-3: the discount claim is persisted here and is the only source the fee
        // calculation reads. It is never echoed through a URL again.
        isBcskStudent: input.isBcskStudent,
        adminNote: input.isBcskStudent ? "Claims BCSK student rate - verify before approving" : null,
      },
    });
    log.info("activation", "application_submitted", { applicationId: app.id, type: "SPECIAL" });
    return this.issued(app.id);
  }

  /**
   * The applicant's own view of their application, for the completion page.
   *
   * Token-gated like the payment step (SEC-7): an application id is a guessable integer, and
   * this returns a name, an email and a payment status.
   */
  async summaryForApplicant(id: number, token: string) {
    await assertPaymentToken(token, id);
    const app = await this.prisma.applicationForm.findUnique({
      where: { id },
      include: { payments: { select: { id: true, status: true, amount: true, method: true, virtualRef: true } } },
    });
    if (!app) throw notFound("Application");
    return {
      id: app.id,
      type: app.type,
      status: app.status,
      applicantName: app.applicantName,
      email: app.email,
      courseName: app.courseName,
      grade: app.grade,
      payments: app.payments,
    };
  }

  async list(req: PageRequest, status?: string) {
    const rows = await this.prisma.applicationForm.findMany({
      where: status ? { status } : undefined,
      orderBy: { id: "desc" },
      include: { payments: { select: { id: true, status: true, amount: true, method: true } } },
      ...toPrismaPage(req),
    });
    return toPage(rows, req);
  }

  async getForStaff(id: number) {
    const app = await this.prisma.applicationForm.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!app) throw notFound("Application");
    return app;
  }

  async approve(id: number, actor: Actor) {
    const app = await this.prisma.applicationForm.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!app) throw notFound("Application");

    const paid = app.payments.some((p) => ["PAID", "VERIFIED"].includes(p.status));
    const result = paid
      ? await this.payments.activateEnrolment(id)
      : (await this.prisma.applicationForm.update({ where: { id }, data: { status: "APPROVED" } }), { studentId: null });

    await this.audit.record(actor.userId, "ADMISSION_DECISION", "ApplicationForm", id, "approved");
    return { applicationId: id, activated: paid, ...result };
  }

  /**
   * Send an application back to the applicant with a note.
   *
   * Distinct from `reject`: the application stays live, the note is what the guardian is
   * asked to fix, and it is stored on `correctionNote` so the applicant's own summary can
   * show it. The rejection path overwrites `adminNote` and is terminal.
   */
  async requestCorrections(id: number, note: string, actor: Actor) {
    const app = await this.prisma.applicationForm.update({
      where: { id },
      data: { status: "CORRECTIONS_REQUESTED", correctionNote: note },
    });
    if (app.email) {
      // The note is staff-written but still reaches an HTML email body.
      const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await this.mail.send(
        app.email,
        "BCSK application - correction needed",
        this.mail.layout(
          "One more step",
          `<p style="font-size:14px;color:#232323">Your application for <b>${escape(app.applicantName)}</b> needs a small correction before we can proceed:</p>
           <p style="font-size:14px;color:#232323;background:#fbf6ea;border-radius:8px;padding:12px">${escape(note)}</p>
           <p style="font-size:14px;color:#232323">Reply to this email or contact the office with the corrected information.</p>`,
        ),
      );
    }
    await this.audit.record(actor.userId, "ADMISSION_DECISION", "ApplicationForm", id, `corrections: ${note}`);
    return { applicationId: id, status: "CORRECTIONS_REQUESTED" };
  }

  async reject(id: number, reason: string, actor: Actor) {
    const app = await this.prisma.applicationForm.update({
      where: { id },
      data: { status: "REJECTED", adminNote: reason },
    });
    if (app.email) {
      await this.mail.send(
        app.email,
        "BCSK application update",
        this.mail.layout(
          "About your application",
          `<p style="font-size:14px;color:#232323">We are sorry - the application for <b>${app.applicantName}</b> could not be accepted.</p>
           <p style="font-size:14px;color:#232323"><b>Reason:</b> ${reason}</p>`,
        ),
      );
    }
    await this.audit.record(actor.userId, "ADMISSION_DECISION", "ApplicationForm", id, `rejected: ${reason}`);
    return { applicationId: id, status: "REJECTED" };
  }
}
