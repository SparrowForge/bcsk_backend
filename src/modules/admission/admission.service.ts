import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { MailService } from "../../common/mail.service";
import { RateLimitService } from "../../common/rate-limit.service";
import { verifyRecaptcha } from "../../common/recaptcha";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import { toPage, toPrismaPage, type PageRequest } from "../../common/pagination/cursor";
import { log } from "../../common/logger";
import { issuePaymentToken, assertPaymentToken } from "../payment/payment-token";
import { PaymentService } from "../payment/payment.service";
import type { Actor } from "../../common/actor";
import { Prisma } from "@prisma/client";
import { SEMESTER_CURRENT } from "../../common/constants";
import type { ApplicationInput } from "./admission.schema";

type FeePreviewQuery = { type: string; grade?: string; courseName?: string; courseLevelId?: number };

/** GAP-12: the specification restricts admission to children aged 5 and above. */
const MINIMUM_AGE_YEARS = 5;

/** Applicant-supplied and staff-written text both reach HTML email bodies. */
function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

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

  /**
   * One entry point for every registration type. The shared applicant fields are written the
   * same way for all of them; only the type-specific checks and columns differ.
   */
  async submit(input: ApplicationInput, ip: string) {
    await this.rateLimit.consume("apply", ip);
    const captcha = await verifyRecaptcha(input.recaptchaToken, "apply");
    if (!captcha.ok) throw unprocessable("Captcha verification failed. Please try again.");
    const dob = this.assertEligible(input.dob);

    const data: Prisma.ApplicationFormCreateInput = {
      type: input.type,
      applicantName: input.applicantName,
      dob,
      gender: input.gender,
      religion: input.religion,
      phone: input.phone,
      email: input.email,
      photoUrl: input.photoPath || null,
      addressKorea: input.addressKorea || null,
      addressBangladesh: input.addressBangladesh,
      emergencyContact: input.emergencyContact,
      learningMode: input.learningMode ?? null,
      semester: SEMESTER_CURRENT,
      parentalConsent: true,
    };

    if (input.type === "SPECIAL") {
      // The course used to be stored as whatever string arrived. Check it is a real, open special
      // course, and that the chosen level belongs to it - activation enrols into that level.
      const course = await this.prisma.course.findFirst({
        where: { slug: input.courseName, type: "SPECIAL", active: true },
        include: { levels: { select: { id: true } } },
      });
      if (!course) throw unprocessable("Choose one of the listed courses.");
      const hasLevels = course.levels.length > 0;
      if (hasLevels && !course.levels.some((l) => l.id === input.courseLevelId)) {
        throw unprocessable("Choose a level or track for this course.");
      }
      data.courseName = input.courseName;
      if (hasLevels) data.courseLevel = { connect: { id: input.courseLevelId! } };
      data.highestEducation = input.highestEducation || null;
      // SEC-3: the discount claim is persisted here and is the only source the fee
      // calculation reads. It is never echoed through a URL again.
      data.isBcskStudent = input.isBcskStudent;
      data.adminNote = input.isBcskStudent ? "Claims BCSK student rate - verify before approving" : null;
    } else {
      const level = await this.regularLevel(input.courseLevelId, input.grade);
      // Fail early on a class with no fee row rather than at the payment step.
      await this.payments.feeStructure({ type: input.type, courseLevelId: level.id, grade: level.code ?? undefined });
      data.courseLevel = { connect: { id: level.id } };
      // The grade text is what enrolment and the classroom still key on; it follows the level.
      data.grade = level.code;
      data.fatherName = input.fatherName || null;
      data.motherName = input.motherName || null;
      if (input.type === "REGULAR") {
        data.guardianProfession = input.guardianProfession || null;
        data.guardianEducation = input.guardianEducation || null;
        data.guardianPhone2 = input.guardianPhone2 || null;
      } else {
        data.studentId = await this.verifyReturningStudent(input.studentId, input.applicantName);
      }
    }

    const app = await this.prisma.applicationForm.create({ data });
    log.info("activation", "application_submitted", { applicationId: app.id, type: input.type });
    return this.issued(app.id);
  }

  /** A class of the Regular Course, by level id or (older callers) by its grade code. */
  private async regularLevel(courseLevelId?: number, grade?: string) {
    const level = await this.prisma.courseLevel.findFirst({
      where: {
        course: { slug: "regular-course" },
        ...(courseLevelId ? { id: courseLevelId } : { code: grade ?? "" }),
      },
    });
    if (!level?.code) throw unprocessable("Choose a class.");
    return level;
  }

  /**
   * A re-admission skips the admission fee, so the claim to be a returning student has to be
   * true. The ID alone is not enough - it is not secret - so the name must match too, and the
   * two failures give one answer so the form cannot be used to probe which IDs exist.
   */
  private async verifyReturningStudent(studentId: string, name: string): Promise<string> {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { studentId: studentId.toUpperCase() },
      include: { user: { select: { name: true, active: true } } },
    });
    const norm = (v: string) => v.trim().replace(/s+/g, " ").toLowerCase();
    if (!profile || !profile.user.active || norm(profile.user.name) !== norm(name) || profile.classLevel === "SPECIAL") {
      throw unprocessable("We could not match that Student ID and name to a current BCSK regular student.");
    }
    return profile.studentId;
  }

  /** The fee table the form shows for a chosen grade or course. */
  feePreview(q: FeePreviewQuery) {
    return this.payments.feeStructure(q);
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
      semester: app.semester,
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
      include: { payments: true, courseLevel: { select: { id: true, name: true } } },
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

    // Record the decision first. It is what lets activation proceed — including when the office
    // approves an application it had earlier rejected — and it must stand even if the payment
    // has not been verified yet, in which case verifying it later creates the account.
    await this.prisma.applicationForm.update({ where: { id }, data: { status: "APPROVED" } });
    const paid = app.payments.some((p) => ["PAID", "VERIFIED"].includes(p.status));
    const result = paid ? await this.payments.activateEnrolment(id) : { studentId: null };

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
      await this.mail.send(
        app.email,
        "BCSK application - correction needed",
        this.mail.layout(
          "One more step",
          `<p style="font-size:14px;color:#232323">Your application for <b>${escapeHtml(app.applicantName)}</b> needs a small correction before we can proceed:</p>
           <p style="font-size:14px;color:#232323;background:#fbf6ea;border-radius:8px;padding:12px">${escapeHtml(note)}</p>
           <p style="font-size:14px;color:#232323">Reply to this email or contact the office with the corrected information.</p>`,
        ),
      );
    }
    await this.audit.record(actor.userId, "ADMISSION_DECISION", "ApplicationForm", id, `corrections: ${note}`);
    return { applicationId: id, status: "CORRECTIONS_REQUESTED" };
  }

  async reject(id: number, reason: string, actor: Actor) {
    const existing = await this.prisma.applicationForm.findUnique({ where: { id } });
    if (!existing) throw notFound("Application");
    if (existing.createdStudentUserId) {
      // Rejecting now would leave an active student account behind a "rejected" label.
      throw conflict("This applicant is already an enrolled student. Withdraw the student instead of rejecting the application.");
    }
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
          `<p style="font-size:14px;color:#232323">We are sorry - the application for <b>${escapeHtml(app.applicantName)}</b> could not be accepted.</p>
           <p style="font-size:14px;color:#232323"><b>Reason:</b> ${escapeHtml(reason)}</p>`,
        ),
      );
    }
    await this.audit.record(actor.userId, "ADMISSION_DECISION", "ApplicationForm", id, `rejected: ${reason}`);
    return { applicationId: id, status: "REJECTED" };
  }
}
