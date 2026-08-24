import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";
import { log, errMessage } from "@/common/logger";

/**
 * Outbound mail. When SMTP is unconfigured the message is logged rather than sent, so
 * admission and payment flows stay exercisable end to end without credentials.
 *
 * Every caller treats delivery as best-effort: an SMTP outage must never fail an
 * enrolment that has already committed (BUG-2).
 */
@Injectable()
export class MailService {
  private readonly from = process.env.SMTP_FROM ?? "BCSK <bcskr22@gmail.com>";

  async send(to: string, subject: string, html: string): Promise<{ simulated: boolean }> {
    if (!process.env.SMTP_HOST) {
      log.info("config", "email_simulated", { to, subject });
      return { simulated: true };
    }
    try {
      const port = Number(process.env.SMTP_PORT ?? 587);
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transporter.sendMail({ from: this.from, to, subject, html });
      return { simulated: false };
    } catch (e) {
      log.error("config", "email_send_failed", { to, subject, error: errMessage(e) });
      return { simulated: true };
    }
  }

  layout(title: string, bodyHtml: string): string {
    return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:12px;overflow:hidden">
    <div style="background:#1d2b64;color:#ffffff;padding:20px 28px">
      <p style="margin:0;font-size:18px;font-weight:bold">Bangladesh Community School, Korea</p>
      <p style="margin:4px 0 0;font-size:12px;color:#d9eef8">বাংলাদেশ কমিউনিটি স্কুল, কোরিয়া</p>
    </div>
    <div style="padding:28px">
      <h1 style="margin:0 0 16px;font-size:20px;color:#1d2b64">${title}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:16px 28px;background:#fbf6ea;font-size:11px;color:#5b5b6b">
      bcskr22@gmail.com · +82 10-6893-6237 · Yongin-si, Gyeonggi-do, South Korea
    </div>
  </div></body></html>`;
  }
}
