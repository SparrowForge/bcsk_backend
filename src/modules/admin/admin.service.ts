import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { AuditService } from "@/common/audit.service";
import { MailService } from "@/common/mail.service";
import { PaymentService } from "@/modules/payment/payment.service";
import { SEMESTER_CURRENT } from "@/common/constants";
import { conflict, notFound, unprocessable } from "@/common/errors/app-error";
import { toPage, toPrismaPage, type PageRequest } from "@/common/pagination/cursor";
import { log } from "@/common/logger";
import type { Actor } from "@/common/actor";

/**
 * The Admin Panel's read and write surface.
 *
 * Grouped into one module rather than eleven because these are small CRUD operations over
 * loosely related tables that share the same audience and the same audit requirement.
 * Splitting them would multiply files without separating anything that actually varies.
 *
 * Authorisation is on the controller via `@RequirePermission`, so each method here can
 * assume the caller already holds the capability its route declares.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly payments: PaymentService,
  ) {}

  /* ------------------------------- dashboard ------------------------------- */

  async dashboard() {
    const [paymentsToVerify, openApplications, openTickets, students, teachers, unanswered] =
      await Promise.all([
        this.prisma.payment.count({ where: { status: "PENDING_VERIFICATION" } }),
        // "Open" is every non-terminal status. CORRECTIONS_REQUESTED was missing, so an
        // application sent back to the applicant was counted nowhere while it sat in flight.
        this.prisma.applicationForm.count({
          where: {
            status: {
              in: ["PENDING_PAYMENT", "PENDING_VERIFICATION", "PAID", "CORRECTIONS_REQUESTED"],
            },
          },
        }),
        this.prisma.supportTicket.count({ where: { status: { not: "CLOSED" } } }),
        // Deactivation is a soft flag on User, so an unfiltered profile count includes every
        // account ever switched off — the card says "Active students" and must mean it.
        this.prisma.studentProfile.count({ where: { user: { active: true } } }),
        this.prisma.teacherProfile.count({ where: { user: { active: true } } }),
        this.prisma.question.count({ where: { answeredAt: null } }),
      ]);
    return { paymentsToVerify, openApplications, openTickets, students, teachers, unanswered };
  }

  /* --------------------------------- CMS ----------------------------------- */

  listPages() {
    return this.prisma.contentPage.findMany({ orderBy: [{ slug: "asc" }, { lang: "asc" }] });
  }

  getPage(slug: string, lang: string) {
    return this.prisma.contentPage.findUnique({ where: { slug_lang: { slug, lang } } });
  }

  async savePage(
    input: { slug: string; lang: string; title: string; content: string; publish: boolean },
    actor: Actor,
  ) {
    // Slugs end up in URLs, so they are normalised rather than trusted.
    const slug = input.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!slug || !input.title.trim()) throw unprocessable("Slug and title are required.");
    if (!["en", "bn", "ko"].includes(input.lang)) throw unprocessable("Unknown language.");

    const status = input.publish ? "PUBLISHED" : "DRAFT";
    const page = await this.prisma.contentPage.upsert({
      where: { slug_lang: { slug, lang: input.lang } },
      update: { title: input.title, content: input.content, status, updatedById: actor.userId },
      create: {
        slug, lang: input.lang, title: input.title, content: input.content,
        status, updatedById: actor.userId,
      },
    });
    await this.audit.record(actor.userId, "CONTENT_EDIT", "ContentPage", `${slug}/${input.lang}`, status);
    return page;
  }

  async deletePage(slug: string, lang: string, actor: Actor) {
    await this.prisma.contentPage.delete({ where: { slug_lang: { slug, lang } } });
    await this.audit.record(actor.userId, "CONTENT_DELETE", "ContentPage", `${slug}/${lang}`);
    return { ok: true };
  }

  /* --------------------------------- news ---------------------------------- */

  listNews() {
    return this.prisma.eventNews.findMany({ orderBy: { date: "desc" } });
  }

  async saveNews(
    input: { id?: number; type: string; title: string; body: string; date: string; published: boolean },
    actor: Actor,
  ) {
    if (!input.title.trim() || !input.body.trim()) throw unprocessable("Title and body are required.");
    const data = {
      type: input.type,
      title: input.title,
      body: input.body,
      date: new Date(input.date),
      published: input.published,
    };
    const row = input.id
      ? await this.prisma.eventNews.update({ where: { id: input.id }, data })
      : await this.prisma.eventNews.create({ data });
    await this.audit.record(actor.userId, "CONTENT_EDIT", "EventNews", row.id, data.title);
    return row;
  }

  async deleteNews(id: number, actor: Actor) {
    await this.prisma.eventNews.delete({ where: { id } });
    await this.audit.record(actor.userId, "CONTENT_DELETE", "EventNews", id);
    return { ok: true };
  }

  /* -------------------------------- gallery -------------------------------- */

  listAlbums() {
    return this.prisma.galleryAlbum.findMany({ include: { items: true } });
  }

  async createAlbum(title: string, category: string | null, actor: Actor) {
    if (!title.trim()) throw unprocessable("Album title is required.");
    const album = await this.prisma.galleryAlbum.create({ data: { title, category } });
    await this.audit.record(actor.userId, "GALLERY_ALBUM_CREATE", "GalleryAlbum", album.id, title);
    return album;
  }

  async addGalleryItem(albumId: number, url: string, caption: string | null, actor: Actor) {
    const item = await this.prisma.galleryItem.create({ data: { albumId, url, caption } });
    await this.audit.record(actor.userId, "GALLERY_UPLOAD", "GalleryItem", item.id);
    return item;
  }

  async deleteGalleryItem(id: number, actor: Actor) {
    await this.prisma.galleryItem.delete({ where: { id } });
    await this.audit.record(actor.userId, "GALLERY_DELETE", "GalleryItem", id);
    return { ok: true };
  }

  async deleteAlbum(id: number, actor: Actor) {
    await this.prisma.galleryAlbum.delete({ where: { id } });
    await this.audit.record(actor.userId, "GALLERY_ALBUM_DELETE", "GalleryAlbum", id);
    return { ok: true };
  }

  /* ----------------------------- hero slider -------------------------------- */

  static readonly HERO_IMAGE_LIMIT = 5;

  listHeroImages() {
    return this.prisma.heroImage.findMany({ orderBy: [{ displayOrder: "asc" }, { id: "asc" }] });
  }

  /** Active images only, in display order — what the public homepage actually renders. */
  publicHeroImages() {
    return this.prisma.heroImage.findMany({
      where: { active: true },
      orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    });
  }

  async addHeroImage(url: string, caption: string | null, actor: Actor) {
    // Capped server-side, not just in the admin UI — a direct POST past a hidden/removed
    // button would otherwise let the slider grow without bound.
    const [count, last] = await Promise.all([
      this.prisma.heroImage.count(),
      this.prisma.heroImage.findFirst({ orderBy: { displayOrder: "desc" } }),
    ]);
    if (count >= AdminService.HERO_IMAGE_LIMIT) {
      throw conflict(`The homepage slider holds at most ${AdminService.HERO_IMAGE_LIMIT} images — remove one first.`);
    }
    // max(displayOrder) + 1, not count — a delete-then-add sequence would otherwise hand out
    // a displayOrder that an existing row already has.
    const displayOrder = (last?.displayOrder ?? -1) + 1;
    const image = await this.prisma.heroImage.create({ data: { url, caption, displayOrder } });
    await this.audit.record(actor.userId, "HERO_IMAGE_UPLOAD", "HeroImage", image.id);
    return image;
  }

  async deleteHeroImage(id: number, actor: Actor) {
    await this.prisma.heroImage.delete({ where: { id } });
    await this.audit.record(actor.userId, "HERO_IMAGE_DELETE", "HeroImage", id);
    return { ok: true };
  }

  /* ---------------------------- governing body ----------------------------- */

  listMembers() {
    return this.prisma.governingMember.findMany({ orderBy: { displayOrder: "asc" } });
  }

  async saveMember(input: Record<string, unknown> & { id?: number }, actor: Actor) {
    const data = {
      kind: String(input.kind ?? "GOVERNING"),
      name: String(input.name ?? "").trim(),
      role: String(input.role ?? "").trim(),
      organization: (String(input.organization ?? "").trim() || null) as string | null,
      region: (String(input.region ?? "").trim() || null) as string | null,
      phone: (String(input.phone ?? "").trim() || null) as string | null,
      email: (String(input.email ?? "").trim() || null) as string | null,
      bio: (String(input.bio ?? "").trim() || null) as string | null,
      displayOrder: Number(input.displayOrder ?? 100) || 100,
    };
    if (!data.name || !data.role) throw unprocessable("Name and role are required.");
    const row = input.id
      ? await this.prisma.governingMember.update({ where: { id: input.id }, data })
      : await this.prisma.governingMember.create({ data });
    await this.audit.record(actor.userId, "CONTENT_EDIT", "GoverningMember", row.id, data.name);
    return row;
  }

  async deleteMember(id: number, actor: Actor) {
    await this.prisma.governingMember.delete({ where: { id } });
    await this.audit.record(actor.userId, "CONTENT_DELETE", "GoverningMember", id);
    return { ok: true };
  }

  /* ---------------------------- student corner ----------------------------- */

  listCornerPosts() {
    return this.prisma.studentCornerPost.findMany({ orderBy: { createdAt: "desc" } });
  }

  async saveCornerPost(
    input: { id?: number; title: string; body: string; studentName: string; kind: string; published: boolean },
    actor: Actor,
  ) {
    if (!input.title.trim() || !input.body.trim() || !input.studentName.trim()) {
      throw unprocessable("Title, body, and student name are required.");
    }
    const data = {
      title: input.title, body: input.body, studentName: input.studentName,
      kind: input.kind, published: input.published,
    };
    const row = input.id
      ? await this.prisma.studentCornerPost.update({ where: { id: input.id }, data })
      : await this.prisma.studentCornerPost.create({ data });
    await this.audit.record(actor.userId, "CONTENT_EDIT", "StudentCornerPost", row.id, data.title);
    return row;
  }

  async deleteCornerPost(id: number, actor: Actor) {
    await this.prisma.studentCornerPost.delete({ where: { id } });
    await this.audit.record(actor.userId, "CONTENT_DELETE", "StudentCornerPost", id);
    return { ok: true };
  }

  /* ---------------------------- courses & levels --------------------------- */

  listCourses() {
    return this.prisma.course.findMany({
      include: { levels: { orderBy: { displayOrder: "asc" } } },
      orderBy: { displayOrder: "asc" },
    });
  }

  async updateCourse(id: number, input: { name: string; description: string; active: boolean }, actor: Actor) {
    if (!input.name.trim()) throw unprocessable("Course name is required.");
    const row = await this.prisma.course.update({ where: { id }, data: input });
    await this.audit.record(actor.userId, "COURSE_UPDATE", "Course", id);
    return row;
  }

  async updateLevel(
    id: number,
    input: { name: string; syllabus: string; studentBookUrl?: string; workBookUrl?: string },
    actor: Actor,
  ) {
    if (!input.name.trim()) throw unprocessable("Level name is required.");
    const row = await this.prisma.courseLevel.update({
      where: { id },
      data: {
        name: input.name,
        syllabus: input.syllabus,
        ...(input.studentBookUrl ? { studentBookUrl: input.studentBookUrl } : {}),
        ...(input.workBookUrl ? { workBookUrl: input.workBookUrl } : {}),
      },
    });
    await this.audit.record(actor.userId, "COURSE_LEVEL_UPDATE", "CourseLevel", id);
    return row;
  }

  async addLevel(courseId: number, actor: Actor) {
    const count = await this.prisma.courseLevel.count({ where: { courseId } });
    const row = await this.prisma.courseLevel.create({
      data: { courseId, name: `Level ${count}`, displayOrder: count, syllabus: "" },
    });
    await this.audit.record(actor.userId, "COURSE_LEVEL_CREATE", "Course", courseId);
    return row;
  }

  /* ---------------------------------- fees --------------------------------- */

  listFees() {
    return this.prisma.feeConfig.findMany({ orderBy: { displayOrder: "asc" } });
  }

  async updateFee(id: number, input: Record<string, unknown>, actor: Actor) {
    const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Math.max(0, Number(v) || 0));
    const row = await this.prisma.feeConfig.update({
      where: { id },
      data: {
        admissionFee: n(input.admissionFee) ?? 0,
        semesterFee: n(input.semesterFee) ?? 0,
        bookFee: n(input.bookFee),
        bcskPrice: n(input.bcskPrice),
        nonBcskPrice: n(input.nonBcskPrice),
        active: Boolean(input.active),
      },
    });
    await this.audit.record(actor.userId, "FEE_UPDATE", "FeeConfig", id);
    return row;
  }

  /* ------------------------------- scheduling ------------------------------ */

  /**
   * Every class session with the three things the scheduling table shows beside it: which
   * course and level it belongs to, who teaches it, and how many students are enrolled.
   * The teacher's `User` row is narrowed to a name for the same reason as everywhere else.
   */
  listSessions() {
    return this.prisma.classSession.findMany({
      include: {
        course: true,
        level: true,
        teacher: { select: { userId: true, user: { select: { name: true } } } },
        // Current roster only: a cancelled or completed enrolment is not a student in the class.
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
      orderBy: { id: "asc" },
    });
  }

  listTeachers() {
    return this.prisma.teacherProfile.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { displayOrder: "asc" },
    });
  }

  async updateSession(id: number, input: Record<string, unknown>, actor: Actor) {
    const row = await this.prisma.classSession.update({
      where: { id },
      data: {
        dayOfWeek: String(input.dayOfWeek ?? "Saturday"),
        startTime: String(input.startTime ?? "10:00"),
        endTime: (String(input.endTime ?? "") || null) as string | null,
        teacherId: input.teacherId ? Number(input.teacherId) : null,
        zoomLink: (String(input.zoomLink ?? "") || null) as string | null,
        active: Boolean(input.active),
      },
    });
    await this.audit.record(actor.userId, "SCHEDULE_UPDATE", "ClassSession", id);
    return row;
  }

  async createSession(input: Record<string, unknown>, actor: Actor) {
    const courseId = Number(input.courseId);
    const title = String(input.title ?? "").trim();
    if (!courseId || !title) throw unprocessable("Course and title are required.");
    const row = await this.prisma.classSession.create({
      data: {
        courseId,
        courseLevelId: input.courseLevelId ? Number(input.courseLevelId) : null,
        classLevel: (String(input.classLevel ?? "") || null) as string | null,
        title,
        dayOfWeek: String(input.dayOfWeek ?? "Saturday"),
        startTime: String(input.startTime ?? "10:00"),
        endTime: (String(input.endTime ?? "") || null) as string | null,
        semester: SEMESTER_CURRENT,
        teacherId: input.teacherId ? Number(input.teacherId) : null,
      },
    });
    await this.audit.record(actor.userId, "SCHEDULE_CREATE", "ClassSession", row.id, title);
    return row;
  }

  /* -------------------------------- tickets -------------------------------- */

  listTickets() {
    return this.prisma.supportTicket.findMany({ orderBy: { createdAt: "desc" } });
  }

  async replyTicket(ticketId: number, reply: string, close: boolean, actor: Actor) {
    if (!reply.trim()) throw unprocessable("Write a reply first.");
    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { reply, status: close ? "CLOSED" : "IN_PROGRESS" },
    });
    // User-supplied text is escaped before it reaches an HTML email body.
    const escape = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await this.mail.send(
      ticket.email,
      `Re: ${ticket.subject} — BCSK support`,
      this.mail.layout(
        "Reply from BCSK office",
        `<p style="font-size:14px;color:#232323">Dear ${escape(ticket.name)},</p>
         <p style="font-size:14px;color:#232323">${escape(reply).replace(/\n/g, "<br/>")}</p>`,
      ),
    );
    await this.audit.record(actor.userId, "TICKET_REPLY", "SupportTicket", ticketId);
    return ticket;
  }

  async setTicketStatus(ticketId: number, status: string, actor: Actor) {
    if (!["OPEN", "IN_PROGRESS", "CLOSED"].includes(status)) throw unprocessable("Unknown status.");
    const row = await this.prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
    await this.audit.record(actor.userId, "TICKET_STATUS", "SupportTicket", ticketId, status);
    return row;
  }

  /** Public: the contact form creates a ticket. */
  async createTicket(input: { name: string; email: string; phone?: string; subject: string; message: string; category: string }) {
    return this.prisma.supportTicket.create({
      data: {
        name: input.name, email: input.email, phone: input.phone || null,
        subject: input.subject, message: input.message, category: input.category,
      },
    });
  }

  /* -------------------------------- reports -------------------------------- */

  /**
   * The student roster the Reports module renders: one row per student, the class they are
   * in, and how many results are already on file.
   *
   * `select` rather than `include` — a `User` row carries `passwordHash`, and this endpoint
   * feeds a page, not a trusted service.
   */
  listStudents() {
    return this.prisma.user.findMany({
      where: { role: "STUDENT" },
      select: {
        id: true, loginId: true, name: true, email: true, role: true,
        active: true, mustChangePassword: true, createdAt: true,
        studentProfile: true,
        _count: { select: { examResults: true } },
      },
      orderBy: { id: "asc" },
    });
  }

  async addExamResult(
    input: { studentUserId: number; semester: string; subject: string; marks: number; fullMarks: number; grade?: string },
    actor: Actor,
  ) {
    if (!input.studentUserId || !input.semester || !input.subject || Number.isNaN(input.marks)) {
      throw unprocessable("Student, semester, subject, and marks are required.");
    }
    const row = await this.prisma.examResult.upsert({
      where: {
        studentUserId_semester_subject: {
          studentUserId: input.studentUserId, semester: input.semester, subject: input.subject,
        },
      },
      update: { marks: input.marks, fullMarks: input.fullMarks, grade: input.grade ?? null },
      create: { ...input, grade: input.grade ?? null },
    });
    await this.audit.record(
      actor.userId, "RESULT_ENTRY", "ExamResult",
      `${input.studentUserId}/${input.semester}/${input.subject}`,
      `${input.marks}/${input.fullMarks}`,
    );
    return row;
  }

  /* --------------------------------- audit --------------------------------- */

  async auditLog(req: PageRequest) {
    const rows = await this.prisma.auditLog.findMany({
      include: { user: { select: { loginId: true, name: true } } },
      orderBy: { id: "desc" },
      ...toPrismaPage(req),
    });
    return toPage(rows, req);
  }

  /* -------------------------------- settings ------------------------------- */

  listSettings() {
    return this.prisma.setting.findMany();
  }

  async saveSettings(values: Record<string, string>, actor: Actor) {
    const entries = Object.entries(values).filter(([, v]) => typeof v === "string");
    // PERF-3: one transaction rather than an upsert round-trip per field.
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } }),
      ),
    );
    await this.audit.record(actor.userId, "SETTINGS_UPDATE", "Setting", "bulk");
    return { updated: entries.length };
  }

  /* -------------------------------- payments ------------------------------- */

  async verifyPayment(paymentId: number, actor: Actor) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { application: true, payer: { include: { studentProfile: true } } },
    });
    if (!payment) throw notFound("Payment");
    if (payment.status !== "PENDING_VERIFICATION") {
      throw conflict("Only a payment awaiting verification can be verified.");
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: "VERIFIED", verifiedById: actor.userId, verifiedAt: new Date() },
    });

    if (payment.applicationId) {
      await this.payments.activateEnrolment(payment.applicationId);
    } else if (payment.payerUserId && payment.purpose === "RE_ADMISSION") {
      const student = await this.prisma.studentProfile.findUnique({
        where: { userId: payment.payerUserId },
        include: { user: true },
      });
      if (student) {
        const sessions = await this.prisma.classSession.findMany({
          where: { classLevel: student.classLevel, semester: SEMESTER_CURRENT, active: true },
        });
        const payerUserId = payment.payerUserId;
        // PERF-3: one transaction rather than a round-trip per class session.
        await this.prisma.$transaction(
          sessions.map((cs) =>
            this.prisma.enrollment.upsert({
              where: {
                studentUserId_classSessionId_semester: {
                  studentUserId: payerUserId, classSessionId: cs.id, semester: SEMESTER_CURRENT,
                },
              },
              update: { status: "ACTIVE" },
              create: { studentUserId: payerUserId, classSessionId: cs.id, semester: SEMESTER_CURRENT },
            }),
          ),
        );
        await this.prisma.notification.create({
          data: {
            userId: payerUserId,
            title: "Re-admission confirmed",
            body: `Your enrollment for semester ${SEMESTER_CURRENT} is renewed.`,
            kind: "ADMIN",
          },
        });
      }
    }

    await this.audit.record(actor.userId, "PAYMENT_VERIFY", "Payment", paymentId, `verified ${payment.amount}`);
    log.info("payment", "verified_by_staff", { paymentId, by: actor.loginId });
    return { paymentId, status: "VERIFIED" };
  }

  async rejectPayment(paymentId: number, reason: string, actor: Actor) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { application: true, payer: { include: { studentProfile: true } } },
    });
    if (!payment) throw notFound("Payment");
    if (payment.status !== "PENDING_VERIFICATION") {
      throw conflict("Only a payment awaiting verification can be rejected.");
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: "REJECTED", rejectReason: reason, verifiedById: actor.userId, verifiedAt: new Date() },
    });
    if (payment.applicationId) {
      await this.prisma.applicationForm.update({
        where: { id: payment.applicationId },
        data: { status: "CORRECTIONS_REQUESTED", correctionNote: reason },
      });
    }
    const email =
      payment.application?.email ?? payment.payer?.studentProfile?.guardianEmail ?? payment.payer?.email;
    if (email) {
      const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await this.mail.send(
        email,
        "BCSK payment could not be verified",
        this.mail.layout(
          "Payment verification failed",
          `<p style="font-size:14px;color:#232323"><b>Reason:</b> ${escape(reason)}</p>
           <p style="font-size:14px;color:#232323">Please contact the office or submit a corrected receipt.</p>`,
        ),
      );
    }
    await this.audit.record(actor.userId, "PAYMENT_REJECT", "Payment", paymentId, reason);
    return { paymentId, status: "REJECTED" };
  }

  async refundPayment(paymentId: number, reason: string, actor: Actor) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw notFound("Payment");
    if (!["PAID", "VERIFIED"].includes(payment.status)) {
      throw conflict("Only a confirmed payment can be refunded.");
    }
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: "REFUNDED", rejectReason: reason, verifiedById: actor.userId, verifiedAt: new Date() },
    });
    await this.audit.record(actor.userId, "PAYMENT_REFUND", "Payment", paymentId, reason);
    return { paymentId, status: "REFUNDED" };
  }

  /* ------------------------------ public reads ----------------------------- */

  /**
   * Settings the public site legitimately needs — school phone numbers, bank details,
   * headline statistics.
   *
   * An allowlist, not a filter: `Setting` also holds gateway keys and integration
   * credentials, so returning the table wholesale would publish them. A new public setting
   * has to be added here deliberately.
   */
  private static readonly PUBLIC_SETTING_KEYS = [
    "stat_total_students", "stat_total_classes", "stat_special_courses", "stat_teachers_staff",
    "whatsapp_number", "support_email", "school_phone", "school_phone2",
    "bank_name", "bank_account_name", "bank_account_number",
    "semester_1_dates", "semester_2_dates",
  ];

  async publicSettings() {
    return this.prisma.setting.findMany({
      where: { key: { in: AdminService.PUBLIC_SETTING_KEYS } },
    });
  }


  curriculum() {
    return this.prisma.curriculumEntry.findMany({
      orderBy: [{ classLevel: "asc" }, { displayOrder: "asc" }],
    });
  }

  /**
   * Homepage "campus right now" widget. Reads the same `isLive` flag a teacher toggles from
   * their own class page (`office.setLive`) — real state a teacher set, never a schedule
   * guess, so there is no timezone or day-of-week matching to get wrong. Attendee counts are
   * aggregate (a number), the same class of fact already public via the homepage stat cards.
   */
  async campusStatus() {
    const sessions = await this.prisma.classSession.findMany({
      where: { semester: SEMESTER_CURRENT, active: true },
      select: {
        id: true,
        title: true,
        classLevel: true,
        isLive: true,
        course: { select: { name: true } },
        teacher: { select: { user: { select: { name: true } } } },
        _count: { select: { enrollments: { where: { status: "ACTIVE" } } } },
      },
      orderBy: [{ isLive: "desc" }, { title: "asc" }],
    });
    const live = sessions.filter((s) => s.isLive);
    return {
      open: live.length > 0,
      liveCount: live.length,
      sessions: live.map((s) => ({
        id: s.id,
        title: s.title,
        courseName: s.course.name,
        classLevel: s.classLevel,
        teacherName: s.teacher?.user.name ?? null,
        students: s._count.enrollments,
      })),
    };
  }

  publishedCornerPosts() {
    return this.prisma.studentCornerPost.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Courses an applicant may choose on the Special Course form. */
  specialCourses() {
    return this.prisma.course.findMany({
      where: { type: "SPECIAL", active: true },
      orderBy: { displayOrder: "asc" },
    });
  }

  /** A course page needs its levels and this semester's timetable. */
  courseBySlug(slug: string) {
    return this.prisma.course.findUnique({
      where: { slug },
      include: {
        levels: { orderBy: { displayOrder: "asc" } },
        sessions: {
          where: { semester: SEMESTER_CURRENT, active: true },
          include: { level: true, teacher: { include: { user: { select: { name: true } } } } },
          orderBy: { id: "asc" },
        },
      },
    });
  }

  async search(query: string, lang: string) {
    const [pages, courses, news] = await Promise.all([
      this.prisma.contentPage.findMany({
        where: {
          status: "PUBLISHED", lang,
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { content: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 10,
      }),
      this.prisma.course.findMany({
        where: {
          active: true,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 10,
      }),
      this.prisma.eventNews.findMany({
        where: {
          published: true,
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { body: { contains: query, mode: "insensitive" } },
          ],
        },
        take: 10,
      }),
    ]);
    return { pages, courses, news };
  }
}
