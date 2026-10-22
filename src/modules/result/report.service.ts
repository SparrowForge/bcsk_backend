import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuditService } from "../../common/audit.service";
import { conflict, notFound, unprocessable } from "../../common/errors/app-error";
import { inInstitute } from "../../common/institute-scope";
import { seoulDate, type Letterhead } from "../../common/pdf";
import type { Actor } from "../../common/actor";
import { randomCode } from "../document/document.service";
import { ResultService } from "./result.service";
import { certificatesPdf, markSheetPdf, sectionResultPdf, tabulationPdf, type RenderedCertificate } from "./result-pdf";
import { assertPrintable, renderTemplate, type TemplateValues } from "./templates";

type Pdf = { filename: string; pdf: Buffer };

/** One CSV cell: quoted, and a leading = + - @ neutralised so a spreadsheet never runs it. */
export function csvCell(v: unknown): string {
  const s = String(v ?? "");
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
const CERT_PREFIX: Record<string, string> = { COMPLETION: "BCSK-COMP", CHARACTER: "BCSK-CHAR", TRANSFER_LETTER: "BCSK-TC" };

/**
 * Printed documents of the LMS: tabulation sheets, mark sheets and result sheets (from processed
 * results, read under ResultService's rules), and certificates printed from the institute's
 * editable templates. A student-facing document gets a serial in the `Certificate` registry so
 * the public verify page can confirm it; its rendered text is stored with it, so a reprint is
 * word for word the document first issued, whatever the template says later.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly results: ResultService,
  ) {}

  async head(instituteId: number): Promise<Letterhead & { headMasterName: string | null; plainName: string }> {
    const i = await this.prisma.institute.findUniqueOrThrow({ where: { id: instituteId } });
    return {
      name: i.name, plainName: i.name, tagline: i.address, headMasterName: i.headMasterName,
      contact: [i.email, i.phone].filter(Boolean).join("  ·  "),
    };
  }

  private rows(data: Awaited<ReturnType<ResultService["sectionReport"]>>) {
    return data.summaries.map((s) => ({
      ...s, name: s.student.name, studentId: s.student.studentProfile?.studentId ?? "",
    }));
  }

  async tabulation(actor: Actor, examId: number, sectionId: number): Promise<Pdf> {
    const data = await this.results.sectionReport(actor, examId, sectionId);
    const rows = this.rows(data);
    assertPrintable("en", ...rows.map((r) => r.name), ...data.subjects);
    const pdf = await tabulationPdf(
      { head: await this.head(actor.instituteId), exam: data.exam.name, term: data.exam.term.code, className: data.className, section: data.section },
      data.subjects, rows,
    );
    return { filename: `tabulation-${examId}-${sectionId}.pdf`, pdf };
  }

  /** The tabulation as CSV, one row per student and one column per subject, for a spreadsheet. */
  async tabulationCsv(actor: Actor, examId: number, sectionId: number): Promise<{ filename: string; csv: string }> {
    const data = await this.results.sectionReport(actor, examId, sectionId);
    const gpa = data.exam.gradingScheme.kind === "GPA";
    const header = ["roll", "student_id", "name", ...data.subjects.flatMap((s) => [`${s} (marks)`, `${s} (grade)`]), "total", "full_marks", "percent", ...(gpa ? ["gpa"] : []), "grade", "result", "failed_subjects", "section_position", "class_position", "withheld"];
    const rows = this.rows(data).map((r) => [
      r.rollNo ?? "", r.studentId, r.name,
      ...data.subjects.flatMap((subject) => {
        const line = r.lines.find((l) => l.subjectName === subject);
        return line ? [line.isAbsent ? "ABS" : line.obtained ?? "", line.grade] : ["", ""];
      }),
      r.totalObtained, r.totalFull, r.percent.toFixed(2), ...(gpa ? [r.gpa != null ? r.gpa.toFixed(2) : ""] : []), r.grade,
      r.passed ? "PASS" : "FAIL", r.failedSubjects, r.sectionPosition ?? "", r.classPosition ?? "", r.withheld ? "yes" : "",
    ]);
    // UTF-8 BOM so Excel reads Bangla and Korean names; every cell quoted and formula-neutralised.
    const csv = "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return { filename: `tabulation-${examId}-${sectionId}.csv`, csv };
  }

  async resultSheet(actor: Actor, examId: number, sectionId: number): Promise<Pdf> {
    const data = await this.results.sectionReport(actor, examId, sectionId);
    if (!["APPROVED", "PUBLISHED"].includes(data.status)) throw unprocessable("A result sheet is printed from approved results.");
    const rows = this.rows(data);
    assertPrintable("en", ...rows.map((r) => r.name));
    const pdf = await sectionResultPdf(
      { head: await this.head(actor.instituteId), exam: data.exam.name, term: data.exam.term.code, className: data.className, section: data.section },
      rows,
    );
    return { filename: `results-${examId}-${sectionId}.pdf`, pdf };
  }

  /** One student's mark sheet. A student gets their own once published, with a verifiable serial. */
  async markSheet(actor: Actor, examId: number, studentUserId: number): Promise<Pdf> {
    const data = await this.results.studentResult(actor, examId, studentUserId);
    const s = this.rows(data)[0];
    if (!s) throw notFound("Result");
    assertPrintable("en", s.name, ...data.subjects);
    const serial = await this.serialFor(actor, studentUserId, examId, "MARK_SHEET", `BCSK-MS-${examId}-`, {
      examId, name: s.name, studentId: s.studentId, gpa: s.gpa, grade: s.grade, total: s.totalObtained,
    });
    const pdf = await markSheetPdf(
      { head: await this.head(actor.instituteId), exam: data.exam.name, term: data.exam.term.code, className: data.className, section: data.section },
      serial, s, data.exam.gradingScheme,
    );
    return { filename: `${serial}.pdf`, pdf };
  }

  /**
   * The serial of one student's document of one kind, issued once (audited) and then reused - until
   * it is revoked, when the next download issues a fresh one.
   */
  private async serialFor(actor: Actor, studentUserId: number, examId: number, type: string, prefix: string, data: unknown): Promise<string> {
    const current = await this.prisma.certificate.findFirst({ where: { studentUserId, type, serial: { startsWith: prefix }, revokedAt: null }, orderBy: { issuedAt: "desc" }, select: { serial: true } });
    if (current) return current.serial;
    const serial = await this.newSerial(studentUserId, type, prefix, data, { examId, issuedById: actor.userId });
    await this.audit.record(actor.userId, `${type}_ISSUE`, "Certificate", serial, `for user ${studentUserId}`);
    return serial;
  }

  async newSerial(studentUserId: number, type: string, prefix: string, data: unknown, from: { examId: number | null; issuedById: number }): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const serial = `${prefix}${randomCode()}`;
      try {
        await this.prisma.certificate.create({ data: { studentUserId, type, serial, dataJson: JSON.stringify(data), examId: from.examId, issuedById: from.issuedById } });
        return serial;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    throw new Error("Could not allocate a document serial.");
  }

  /* ----------------------------------------------------------------- templates */

  templates(actor: Actor) {
    return this.prisma.documentTemplate.findMany({ where: inInstitute(actor), orderBy: [{ type: "asc" }, { lang: "asc" }] });
  }

  async saveTemplate(actor: Actor, type: string, lang: string, input: { title: string; body: string; signatoryName: string | null; signatoryTitle: string | null }, ip?: string) {
    const where = { instituteId_type_lang: { instituteId: actor.instituteId, type, lang } };
    const before = await this.prisma.documentTemplate.findUnique({ where });
    const row = await this.prisma.documentTemplate.upsert({
      where,
      create: { ...inInstitute(actor), type, lang, ...input, updatedById: actor.userId },
      update: { ...input, updatedById: actor.userId },
    });
    await this.audit.record(actor.userId, "TEMPLATE_SAVE", "DocumentTemplate", row.id, `${type} (${lang})`, {
      ip, diff: before ? { before: { title: before.title, body: before.body }, after: { title: input.title, body: input.body } } : null,
    });
    return row;
  }

  /* ----------------------------------------------------------------- certificates */

  /** The values a certificate's placeholders are filled from, for one student. */
  async values(actor: Actor, studentUserId: number, examId: number | null, termId: number | null): Promise<TemplateValues & { _sectionId?: number }> {
    const student = await this.prisma.user.findFirst({
      where: { id: studentUserId, ...inInstitute(actor), role: "STUDENT" },
      select: { name: true, studentProfile: { select: { studentId: true } }, institute: { select: { name: true } } },
    });
    if (!student) throw notFound("Student");
    const place = await this.prisma.sectionEnrollment.findFirst({
      where: { studentUserId, batch: { term: { ...inInstitute(actor), ...(termId ? { id: termId } : { isCurrent: true }) } } },
      orderBy: { id: "desc" },
      select: { sectionId: true, section: { select: { name: true } }, batch: { select: { term: { select: { name: true } }, courseLevel: { select: { name: true, course: { select: { name: true } } } } } } },
    });
    let resultLine = "";
    let gpa = "", grade = "";
    if (examId) {
      const summary = await this.prisma.resultSummary.findUnique({ where: { examId_studentUserId: { examId, studentUserId } }, include: { exam: { select: { name: true } } } });
      const published = summary && (await this.prisma.sectionResult.findUnique({ where: { examId_sectionId: { examId, sectionId: summary.sectionId } } }))?.status === "PUBLISHED";
      if (!summary || !published) throw unprocessable("This student has no published result in that exam.");
      if (summary.withheld) throw unprocessable("This student's result in that exam is withheld.");
      if (!summary.passed) throw unprocessable("This student did not pass that exam.");
      gpa = summary.gpa != null ? summary.gpa.toFixed(2) : "";
      grade = summary.grade;
      resultLine = `, obtaining ${gpa ? `GPA ${gpa} (grade ${grade})` : `grade ${grade}`} in the ${summary.exam.name}`;
    }
    return {
      name: student.name,
      studentId: student.studentProfile?.studentId ?? "",
      class: place ? `${place.batch.courseLevel.course.name === "Regular Course" ? "" : `${place.batch.courseLevel.course.name} `}${place.batch.courseLevel.name}` : "",
      section: place?.section.name ?? "",
      term: place?.batch.term.name ?? "",
      institute: student.institute.name,
      date: seoulDate(),
      gpa, grade, resultLine,
      _sectionId: place?.sectionId,
    };
  }

  async render(actor: Actor, type: string, lang: string, values: TemplateValues): Promise<RenderedCertificate> {
    const t = await this.prisma.documentTemplate.findUnique({ where: { instituteId_type_lang: { instituteId: actor.instituteId, type, lang } } });
    if (!t) throw unprocessable(`Write the ${type.toLowerCase()} certificate's wording (${lang}) first.`);
    const institute = await this.prisma.institute.findUniqueOrThrow({ where: { id: actor.instituteId }, select: { headMasterName: true } });
    const out = {
      title: renderTemplate(t.title, values), body: renderTemplate(t.body, values),
      signatoryName: t.signatoryName ?? institute.headMasterName, signatoryTitle: t.signatoryTitle,
    };
    assertPrintable(lang, out.title, out.body, out.signatoryName ?? "", out.signatoryTitle ?? "");
    return out;
  }

  /** Issue one certificate: a new serial each time, its text kept for an identical reprint. */
  async issue(actor: Actor, input: { studentUserId: number; type: string; lang: string; examId: number | null; termId: number | null }, ip?: string): Promise<Pdf> {
    const { _sectionId, ...values } = await this.values(actor, input.studentUserId, input.examId, input.termId);
    const rendered = await this.render(actor, input.type, input.lang, values);
    const serial = await this.newSerial(input.studentUserId, input.type, `${CERT_PREFIX[input.type]}-${new Date().getFullYear()}-`, { ...rendered, lang: input.lang }, { examId: input.examId, issuedById: actor.userId });
    await this.audit.record(actor.userId, "CERTIFICATE_ISSUE", "Certificate", serial, `${input.type} for user ${input.studentUserId}`, { ip });
    return { filename: `${serial}.pdf`, pdf: await certificatesPdf(await this.head(actor.instituteId), [{ ...rendered, serial }]) };
  }

  /**
   * Bulk printing: one certificate per active student of a section, in one PDF. With an exam,
   * a completion certificate goes only to the students who passed it.
   */
  async issueForSection(actor: Actor, input: { sectionId: number; type: string; lang: string; examId: number | null }, ip?: string): Promise<Pdf> {
    const section = await this.prisma.section.findFirst({ where: { id: input.sectionId, batch: { term: inInstitute(actor) } }, select: { id: true, batch: { select: { termId: true } } } });
    if (!section) throw notFound("Section");
    let students = (await this.prisma.sectionEnrollment.findMany({
      where: { sectionId: section.id, status: "ACTIVE" }, orderBy: [{ rollNo: { sort: "asc", nulls: "last" } }], select: { studentUserId: true },
    })).map((s) => s.studentUserId);
    if (input.examId) {
      const passed = new Set((await this.prisma.resultSummary.findMany({ where: { examId: input.examId, sectionId: section.id, passed: true, withheld: false }, select: { studentUserId: true } })).map((s) => s.studentUserId));
      students = students.filter((id) => passed.has(id));
    }
    if (students.length === 0) throw unprocessable("No student of this section qualifies for this certificate.");
    const pages = [];
    for (const studentUserId of students) {
      const { _sectionId, ...values } = await this.values(actor, studentUserId, input.examId, section.batch.termId);
      const rendered = await this.render(actor, input.type, input.lang, values);
      const serial = await this.newSerial(studentUserId, input.type, `${CERT_PREFIX[input.type]}-${new Date().getFullYear()}-`, { ...rendered, lang: input.lang }, { examId: input.examId, issuedById: actor.userId });
      pages.push({ ...rendered, serial });
    }
    await this.audit.record(actor.userId, "CERTIFICATE_ISSUE_BULK", "Section", section.id, `${input.type}: ${pages.length} certificates`, { ip });
    return { filename: `${input.type.toLowerCase()}-section-${section.id}.pdf`, pdf: await certificatesPdf(await this.head(actor.instituteId), pages) };
  }

  /** A student's own issued documents, for the Documents page. */
  issued(actor: Actor) {
    return this.prisma.certificate.findMany({
      where: { studentUserId: actor.userId },
      orderBy: { issuedAt: "desc" },
      select: { serial: true, type: true, issuedAt: true, revokedAt: true },
    });
  }

  /** Every document issued to one student of the institute, revoked ones included, for staff. */
  async issuedTo(actor: Actor, studentUserId: number) {
    const student = await this.prisma.user.findFirst({ where: { id: studentUserId, ...inInstitute(actor) }, select: { id: true } });
    if (!student) throw notFound("Student");
    return this.prisma.certificate.findMany({
      where: { studentUserId },
      orderBy: { issuedAt: "desc" },
      select: { serial: true, type: true, issuedAt: true, examId: true, issuedById: true, revokedAt: true, revokeReason: true },
    });
  }

  /**
   * Withdraw an issued document - issued in error, or superseded. The serial stays in the registry
   * and verifies as revoked; it can no longer be reprinted. Any kind can be revoked, mark sheets
   * and transfer letters included: the public verify page is where a paper copy is checked.
   */
  async revoke(actor: Actor, serial: string, reason: string, ip?: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { serial }, select: { id: true, type: true, studentUserId: true, revokedAt: true, student: { select: { instituteId: true } } } });
    if (!cert || cert.student.instituteId !== actor.instituteId) throw notFound("Document");
    if (cert.revokedAt) throw conflict("This document is already revoked.");
    const revokedAt = new Date();
    await this.prisma.certificate.update({ where: { id: cert.id }, data: { revokedAt, revokedById: actor.userId, revokeReason: reason } });
    await this.audit.record(actor.userId, "CERTIFICATE_REVOKE", "Certificate", serial, `${cert.type} for user ${cert.studentUserId}: ${reason}`, {
      ip, diff: { before: { revokedAt: null }, after: { revokedAt: revokedAt.toISOString(), reason } },
    });
    return { serial, revokedAt };
  }

  /** Reprint an issued certificate, word for word, for its student or staff. */
  async reprint(actor: Actor, serial: string): Promise<Pdf> {
    const cert = await this.prisma.certificate.findUnique({ where: { serial }, include: { student: { select: { instituteId: true } } } });
    if (!cert || cert.student.instituteId !== actor.instituteId) throw notFound("Document");
    if (actor.role === "STUDENT" && cert.studentUserId !== actor.userId) throw notFound("Document");
    if (cert.revokedAt) throw conflict("This document was revoked and can't be printed again.");
    if (!(cert.type in CERT_PREFIX)) throw unprocessable("Download this document from its own page.");
    const data = JSON.parse(cert.dataJson) as RenderedCertificate;
    return { filename: `${serial}.pdf`, pdf: await certificatesPdf(await this.head(actor.instituteId), [{ ...data, serial }]) };
  }
}
