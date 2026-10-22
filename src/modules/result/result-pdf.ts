import PDFDocument from "pdfkit";
import { INK, NAVY, SOFT, SUNRISE, docToBuffer, footer, letterhead, seoulDate, type Letterhead } from "../../common/pdf";
import { fontFor, writeMixed } from "../../common/pdf-fonts";

/**
 * The LMS reports as PDFs (B5): a section's tabulation sheet, one student's mark sheet, a
 * section's result sheet, and certificates printed from an editable template. Helvetica covers
 * English text; Bengali and Korean need embedded fonts, which arrive in B7 - until then those
 * languages are refused before a PDF is drawn (see `assertPrintable`).
 */

type Line = { subjectName: string; fullMarks: number; passMarks: number; obtained: number | null; isAbsent: boolean; grade: string; gradePoint: number | null; passed: boolean };
type Summary = {
  rollNo: number | null; name: string; studentId: string;
  totalObtained: number; totalFull: number; percent: number; gpa: number | null; grade: string; passed: boolean;
  sectionPosition: number | null; classPosition: number | null; lines: Line[];
};
type Heading = { head: Letterhead; exam: string; term: string; className: string; section: string };

const mark = (l: { obtained: number | null; isAbsent: boolean }) => (l.isAbsent ? "Abs" : String(l.obtained ?? "-"));
const gpaText = (g: number | null) => (g == null ? "" : g.toFixed(2));

/** Section-wide tabulation: a row per student, a column per subject. A4 landscape. */
export async function tabulationPdf(h: Heading, subjects: string[], rows: Summary[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
  letterhead(doc, `Tabulation Sheet - ${h.exam}`, h.head);
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(`${h.className}, section ${h.section}  ·  Term ${h.term}`, 50, 148);

  const left = 36, width = doc.page.width - 72;
  const fixed = [32, 150]; // roll, name
  const tail = [52, 46, 40, 40, 34]; // total, %, GPA, grade, place
  const subjectW = Math.max(36, (width - fixed[0]! - fixed[1]! - tail.reduce((a, b) => a + b, 0)) / Math.max(1, subjects.length));
  const cols = [...fixed, ...subjects.map(() => subjectW), ...tail];
  const heads = ["Roll", "Student", ...subjects, "Total", "%", "GPA", "Grade", "Place"];

  let y = 170;
  const drawRow = (cells: string[], bold: boolean, fill?: string) => {
    if (y > doc.page.height - 70) { doc.addPage({ size: "A4", layout: "landscape", margin: 36 }); y = 40; }
    if (fill) doc.rect(left, y, width, 18).fill(fill);
    let x = left;
    cells.forEach((c, i) => {
      fontFor(doc, c, bold).fontSize(7.5).fillColor(bold ? NAVY : INK)
        .text(c, x + 2, y + 5, { width: cols[i]! - 4, align: i < 2 ? "left" : "center", lineBreak: false, ellipsis: true });
      x += cols[i]!;
    });
    doc.moveTo(left, y + 18).lineTo(left + width, y + 18).lineWidth(0.4).strokeColor("#e8e4da").stroke();
    y += 18;
  };
  drawRow(heads, true, "#fbf6ea");
  for (const r of rows) {
    const bySubject = new Map(r.lines.map((l) => [l.subjectName, l]));
    drawRow([
      String(r.rollNo ?? ""), r.name,
      ...subjects.map((s) => { const l = bySubject.get(s); return l ? `${mark(l)} ${l.grade}` : ""; }),
      `${r.totalObtained}/${r.totalFull}`, String(r.percent), gpaText(r.gpa), r.grade, String(r.sectionPosition ?? ""),
    ], false);
  }
  doc.font("Helvetica").fontSize(7).fillColor(SOFT).text(`Prepared ${seoulDate()}. Each subject shows marks and grade; Abs = absent.`, left, doc.page.height - 50);
  return docToBuffer(doc);
}

/** One student's mark sheet for one exam, with a verifiable serial. */
export async function markSheetPdf(h: Heading, serial: string, s: Summary, scheme: { name: string; kind: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  letterhead(doc, `Mark Sheet - ${h.exam}`, h.head);
  writeMixed(doc.fontSize(11).fillColor(INK), `Name: ${s.name}`, 50, 158, {});
  doc.font("Helvetica").fontSize(11).fillColor(INK)
    .text(`Student ID: ${s.studentId}    Roll: ${s.rollNo ?? "-"}`, 50, 175)
    .text(`Class: ${h.className}, section ${h.section}    Term: ${h.term}`, 50, 192);

  let y = 222;
  doc.rect(50, y, doc.page.width - 100, 24).fill("#fbf6ea");
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(NAVY)
    .text("Subject", 60, y + 8).text("Full", 270, y + 8).text("Pass", 320, y + 8).text("Obtained", 370, y + 8).text("Grade", 445, y + 8).text("Point", 495, y + 8);
  y += 24;
  for (const l of s.lines) {
    doc.font("Helvetica").fontSize(9.5).fillColor(l.passed ? INK : "#b42318")
      .text(l.subjectName, 60, y + 7, { width: 200 }).text(String(l.fullMarks), 270, y + 7).text(String(l.passMarks), 320, y + 7)
      .text(mark(l), 370, y + 7).font("Helvetica-Bold").text(l.grade, 445, y + 7).font("Helvetica").text(gpaText(l.gradePoint), 495, y + 7);
    doc.moveTo(50, y + 23).lineTo(doc.page.width - 50, y + 23).strokeColor("#e8e4da").stroke();
    y += 23;
  }
  y += 14;
  doc.roundedRect(50, y, doc.page.width - 100, 64, 8).fill("#f4f7fb");
  doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY)
    .text(`Total ${s.totalObtained} / ${s.totalFull}  (${s.percent}%)`, 66, y + 12)
    .text(`${scheme.kind === "GPA" ? `GPA ${gpaText(s.gpa)}  ·  ` : ""}Grade ${s.grade}  ·  ${s.passed ? "Passed" : "Not passed"}`, 66, y + 30);
  doc.font("Helvetica").fontSize(10).fillColor(SOFT)
    .text(`Place in section: ${s.sectionPosition ?? "-"}    Place in class: ${s.classPosition ?? "-"}`, 66, y + 48);
  doc.font("Helvetica").fontSize(8).fillColor(SOFT).text(`Graded on ${scheme.name}.`, 50, y + 80);
  signature(doc, y + 130, "Head Master", h.head.name);
  footer(doc, serial);
  return docToBuffer(doc);
}

/** A section's published result list: who passed, with GPA, grade and place. */
export async function sectionResultPdf(h: Heading, rows: Summary[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  letterhead(doc, `Result Sheet - ${h.exam}`, h.head);
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(`${h.className}, section ${h.section}  ·  Term ${h.term}`, 50, 150);
  const cols: Array<[string, number]> = [["Roll", 50], ["Student", 90], ["Student ID", 270], ["Total", 360], ["GPA", 420], ["Grade", 465], ["Place", 510]];
  let y = 172;
  doc.rect(50, y, doc.page.width - 100, 22).fill("#fbf6ea");
  for (const [label, x] of cols) doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY).text(label, x + 4, y + 7);
  y += 22;
  for (const r of rows) {
    if (y > doc.page.height - 90) { doc.addPage(); y = 50; }
    const cells = [String(r.rollNo ?? ""), r.name, r.studentId, `${r.totalObtained}/${r.totalFull}`, gpaText(r.gpa), r.grade, String(r.sectionPosition ?? "")];
    cells.forEach((c, i) => fontFor(doc, c, i === 5).fontSize(9).fillColor(r.passed ? INK : "#b42318").text(c, cols[i]![1] + 4, y + 6, { width: 170, lineBreak: false, ellipsis: true }));
    doc.moveTo(50, y + 20).lineTo(doc.page.width - 50, y + 20).strokeColor("#e8e4da").stroke();
    y += 20;
  }
  const passed = rows.filter((r) => r.passed).length;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(`${passed} of ${rows.length} passed`, 50, y + 14);
  doc.font("Helvetica").fontSize(7).fillColor(SOFT).text(`Published ${seoulDate()}.`, 50, doc.page.height - 50);
  return docToBuffer(doc);
}

function signature(doc: PDFKit.PDFDocument, y: number, title: string, name: string | null) {
  doc.moveTo(doc.page.width - 230, y).lineTo(doc.page.width - 60, y).strokeColor(SOFT).lineWidth(0.8).stroke();
  writeMixed(doc.fontSize(10).fillColor(INK), title, doc.page.width - 230, y + 6, { width: 170, align: "center" });
  if (name) writeMixed(doc.fontSize(9).fillColor(SOFT), name, doc.page.width - 230, y + 20, { width: 170, align: "center" });
}

export type RenderedCertificate = { title: string; body: string; signatoryName: string | null; signatoryTitle: string | null };

/** One or many certificates, one page each, from rendered template text. */
export async function certificatesPdf(head: Letterhead, pages: Array<RenderedCertificate & { serial: string }>): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: false });
  for (const p of pages) {
    doc.addPage({ size: "A4", margin: 50 });
    letterhead(doc, p.title, head);
    doc.rect(36, 150, doc.page.width - 72, 360).lineWidth(1.2).strokeColor(SUNRISE).stroke();
    writeMixed(doc.fontSize(12.5).fillColor(INK), p.body, 70, 200, { width: doc.page.width - 140, align: "center", lineGap: 6 });
    signature(doc, 560, p.signatoryTitle ?? "Head Master", p.signatoryName);
    doc.font("Helvetica").fontSize(9).fillColor(SOFT).text(`Date: ${seoulDate()}`, 70, 566);
    footer(doc, p.serial);
  }
  return docToBuffer(doc);
}
