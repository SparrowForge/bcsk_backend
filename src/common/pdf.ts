import PDFDocument from "pdfkit";
import QRCode from "qrcode";

const NAVY = "#1d2b64";
const SKY = "#38a8dc";
const SUNRISE = "#f5820b";
const INK = "#232323";
const SOFT = "#5b5b6b";

function docToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function letterhead(doc: PDFKit.PDFDocument, title: string) {
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fill("white").font("Helvetica-Bold").fontSize(18).text("Bangladesh Community School, Korea", 50, 24);
  doc.font("Helvetica").fontSize(9).fillColor("#d9eef8")
    .text("The first Bangladeshi community school in South Korea", 50, 48)
    .text("bcskr22@gmail.com  ·  +82 10-6893-6237  ·  Yongin-si, Gyeonggi-do", 50, 62);
  doc.moveDown(2);
  doc.fillColor(SUNRISE).font("Helvetica-Bold").fontSize(16).text(title, 50, 115);
  doc.moveTo(50, 138).lineTo(doc.page.width - 50, 138).lineWidth(1).strokeColor(SKY).stroke();
}

function footer(doc: PDFKit.PDFDocument, serial: string) {
  const y = doc.page.height - 60;
  doc.fontSize(8).fillColor(SOFT)
    .text(`Document no: ${serial}  ·  Issued: ${new Date().toISOString().slice(0, 10)}  ·  Verify: bcskr.org`, 50, y, {
      width: doc.page.width - 100,
      align: "center",
    });
}

/** FR-ADM-08: payment receipt PDF. */
export async function receiptPdf(data: {
  serial: string;
  payerName: string;
  purpose: string;
  method: string;
  amount: number;
  status: string;
  reference: string | null;
  date: Date;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  letterhead(doc, "Payment Receipt");

  const rows: Array<[string, string]> = [
    ["Receipt No.", data.serial],
    ["Received from", data.payerName],
    ["Purpose", data.purpose.replace(/_/g, " ")],
    ["Payment method", data.method === "CARD" ? "Card (payment gateway)" : "Bank transfer (Hana Bank)"],
    ["Reference", data.reference ?? "—"],
    ["Date", data.date.toISOString().slice(0, 10)],
    ["Status", data.status],
  ];
  let y = 165;
  for (const [k, v] of rows) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(SOFT).text(k, 50, y, { width: 150 });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(v, 210, y);
    y += 24;
  }
  doc.roundedRect(50, y + 10, doc.page.width - 100, 54, 8).fill("#fbf6ea");
  doc.font("Helvetica-Bold").fontSize(11).fillColor(SOFT).text("Amount received", 70, y + 26);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text(`KRW ${data.amount.toLocaleString("en-US")}`, 0, y + 22, {
    align: "right",
    width: doc.page.width - 70,
  });
  doc.font("Helvetica").fontSize(9).fillColor(SOFT).text(
    "This receipt is issued electronically by the BCSK admission & payment system and is valid without a signature.",
    50, y + 90, { width: doc.page.width - 100 }
  );
  footer(doc, data.serial);
  return docToBuffer(doc);
}

/** FR-STU-05: enrollment certificate PDF. */
export async function certificatePdf(data: {
  serial: string;
  studentName: string;
  studentId: string;
  classLevel: string;
  semester: string;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  letterhead(doc, "Enrollment Certificate");
  doc.font("Helvetica").fontSize(12).fillColor(INK).text(
    `This is to certify that`,
    50, 180, { align: "center", width: doc.page.width - 100 }
  );
  doc.font("Helvetica-Bold").fontSize(22).fillColor(NAVY).text(data.studentName, { align: "center", width: doc.page.width - 100 });
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(12).fillColor(INK).text(
    `Student ID ${data.studentId} is a bona fide student of Bangladesh Community School, Korea,\nenrolled in ${data.classLevel} for the ${data.semester} semester.`,
    { align: "center", width: doc.page.width - 100 }
  );
  doc.moveDown(2);
  doc.fontSize(11).fillColor(SOFT).text(
    "Issued for official use upon request of the guardian.",
    { align: "center", width: doc.page.width - 100 }
  );
  // signature line
  const y = 460;
  doc.moveTo(doc.page.width - 220, y).lineTo(doc.page.width - 60, y).strokeColor(SOFT).stroke();
  doc.fontSize(10).fillColor(INK).text("Principal", doc.page.width - 220, y + 6, { width: 160, align: "center" });
  doc.text("Prof. Dr. Manwar Hussain", doc.page.width - 220, y + 20, { width: 160, align: "center" });
  footer(doc, data.serial);
  return docToBuffer(doc);
}

/** FR-STU-09: digital ID card PDF with QR verification code. */
export async function idCardPdf(data: {
  serial: string;
  studentName: string;
  studentId: string;
  classLevel: string;
  verifyUrl: string;
}): Promise<Buffer> {
  // credit-card ratio at ~3x scale
  const W = 486, H = 306;
  const doc = new PDFDocument({ size: [W, H], margin: 0 });
  doc.rect(0, 0, W, H).fill("white");
  doc.rect(0, 0, W, 74).fill(NAVY);
  doc.circle(W - 40, 100, 70).fillOpacity(0.08).fill(SKY).fillOpacity(1);
  doc.fill("white").font("Helvetica-Bold").fontSize(15).text("Bangladesh Community School, Korea", 20, 18);
  doc.font("Helvetica").fontSize(8).fillColor("#d9eef8").text("STUDENT IDENTITY CARD", 20, 40);

  doc.font("Helvetica-Bold").fontSize(20).fillColor(NAVY).text(data.studentName, 20, 100, { width: 300 });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(SUNRISE).text(data.studentId, 20, 132);
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(`Class: ${data.classLevel}`, 20, 152);
  doc.text(`Valid: ${new Date().getFullYear()} academic year`, 20, 168);
  doc.fontSize(8).fillColor(SOFT).text("If found, please return to BCSK · bcskr22@gmail.com", 20, H - 34, { width: 280 });

  const qrPng = await QRCode.toBuffer(data.verifyUrl, { width: 240, margin: 1, color: { dark: NAVY } });
  doc.image(qrPng, W - 140, 96, { width: 120, height: 120 });
  doc.fontSize(7).fillColor(SOFT).text("Scan to verify", W - 140, 220, { width: 120, align: "center" });
  return docToBuffer(doc);
}

/** FR-STU-05: result sheet PDF. */
export async function resultSheetPdf(data: {
  serial: string;
  studentName: string;
  studentId: string;
  classLevel: string;
  semester: string;
  rows: Array<{ subject: string; marks: number; fullMarks: number; grade: string | null }>;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  letterhead(doc, `Result Sheet — Semester ${data.semester}`);
  doc.font("Helvetica").fontSize(11).fillColor(INK)
    .text(`Name: ${data.studentName}`, 50, 160)
    .text(`Student ID: ${data.studentId}    Class: ${data.classLevel}`, 50, 178);

  let y = 215;
  doc.rect(50, y, doc.page.width - 100, 26).fill("#fbf6ea");
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY)
    .text("Subject", 62, y + 8).text("Marks", 300, y + 8).text("Full Marks", 380, y + 8).text("Grade", 470, y + 8);
  y += 26;
  for (const r of data.rows) {
    doc.font("Helvetica").fontSize(10).fillColor(INK)
      .text(r.subject, 62, y + 7).text(String(r.marks), 300, y + 7).text(String(r.fullMarks), 380, y + 7)
      .font("Helvetica-Bold").text(r.grade ?? "—", 470, y + 7);
    doc.moveTo(50, y + 24).lineTo(doc.page.width - 50, y + 24).strokeColor("#e8e4da").stroke();
    y += 24;
  }
  const total = data.rows.reduce((s, r) => s + r.marks, 0);
  const full = data.rows.reduce((s, r) => s + r.fullMarks, 0);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(`Total: ${total} / ${full}`, 62, y + 14);
  footer(doc, data.serial);
  return docToBuffer(doc);
}
