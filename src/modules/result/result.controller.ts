import { Body, Controller, Get, Param, Patch, Post, Put, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import { ResultService } from "./result.service";
import { ReportService } from "./report.service";
import { bulkIssueSchema, issueSchema, noteSchema, rankTiesSchema, templateKey, templateSchema } from "./result.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import { clientIp } from "../../common/client-ip";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();
const serial = z.string().trim().min(6).max(60).regex(/^[A-Z0-9-]+$/);

/** Send a generated CSV as a download. */
export function sendCsv(res: Response, file: { filename: string; csv: string }) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.csv);
}

/** Send a generated PDF as a download. */
export function sendPdf(res: Response, file: { filename: string; pdf: Buffer }) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.pdf);
}

/**
 * Results, reports and certificates on the admin panel. Processing, approving and returning need
 * `results:approve`; publishing and withdrawing `results:publish`; reading and printing
 * `reports:manage`; issuing and revoking certificates `certificates:issue`. All of them are the
 * Head Master's by default; the office has the reports and certificates ones too.
 */
@Roles(...ADMIN_ROLES)
@Controller()
export class ResultController {
  constructor(
    private readonly results: ResultService,
    private readonly reports: ReportService,
  ) {}

  /* workflow */
  @RequirePermission("results:approve") @Get("results/exams/:examId")
  overview(@Param("examId") raw: string, @CurrentActor() a: Actor) { return this.results.overview(a, id.parse(raw)); }

  @RequirePermission("results:approve") @Post("results/exams/:examId/levels/:levelId/process")
  process(@Param("examId") e: string, @Param("levelId") l: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.process(a, id.parse(e), id.parse(l), clientIp(r));
  }

  @RequirePermission("results:approve") @Post("results/exams/:examId/sections/:sectionId/approve")
  approve(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.approve(a, id.parse(e), id.parse(s), clientIp(r));
  }

  @RequirePermission("results:approve") @Post("results/exams/:examId/sections/:sectionId/return")
  returnResults(@Param("examId") e: string, @Param("sectionId") s: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.returnToTeachers(a, id.parse(e), id.parse(s), noteSchema.parse(b).note, clientIp(r));
  }

  @RequirePermission("results:publish") @Post("results/exams/:examId/sections/:sectionId/publish")
  publish(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.publish(a, id.parse(e), id.parse(s), clientIp(r));
  }

  @RequirePermission("results:publish") @Post("results/exams/:examId/sections/:sectionId/withdraw")
  withdraw(@Param("examId") e: string, @Param("sectionId") s: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.withdraw(a, id.parse(e), id.parse(s), noteSchema.parse(b).note, clientIp(r));
  }

  /* one student's result held back, and released */
  @RequirePermission("results:publish") @Post("results/exams/:examId/students/:userId/withhold")
  withhold(@Param("examId") e: string, @Param("userId") u: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.withhold(a, id.parse(e), id.parse(u), noteSchema.parse(b).note, clientIp(r));
  }

  @RequirePermission("results:publish") @Post("results/exams/:examId/students/:userId/release")
  release(@Param("examId") e: string, @Param("userId") u: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.release(a, id.parse(e), id.parse(u), clientIp(r));
  }

  @RequirePermission("institute:manage") @Patch("results/settings")
  settings(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.results.setRankTies(a, rankTiesSchema.parse(b).rankTies, clientIp(r));
  }

  /* reports */
  @RequirePermission("reports:manage") @Get("results/exams/:examId/sections/:sectionId")
  sectionReport(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor) {
    return this.results.sectionReport(a, id.parse(e), id.parse(s));
  }

  @RequirePermission("reports:manage") @Get("results/exams/:examId/sections/:sectionId/tabulation.pdf")
  async tabulation(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendPdf(res, await this.reports.tabulation(a, id.parse(e), id.parse(s)));
  }

  @RequirePermission("reports:manage") @Get("results/exams/:examId/sections/:sectionId/tabulation.csv")
  async tabulationCsv(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendCsv(res, await this.reports.tabulationCsv(a, id.parse(e), id.parse(s)));
  }

  @RequirePermission("reports:manage") @Get("results/exams/:examId/sections/:sectionId/result-sheet.pdf")
  async resultSheet(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendPdf(res, await this.reports.resultSheet(a, id.parse(e), id.parse(s)));
  }

  @RequirePermission("reports:manage") @Get("results/exams/:examId/students/:userId/mark-sheet.pdf")
  async markSheet(@Param("examId") e: string, @Param("userId") u: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendPdf(res, await this.reports.markSheet(a, id.parse(e), id.parse(u)));
  }

  @RequirePermission("students:read") @Get("students/:userId/performance")
  performance(@Param("userId") u: string, @CurrentActor() a: Actor) { return this.results.studentPerformance(a, id.parse(u)); }

  /* templates and certificates */
  @RequirePermission("reports:manage") @Get("document-templates")
  templates(@CurrentActor() a: Actor) { return this.reports.templates(a); }

  @RequirePermission("reports:manage") @Put("document-templates/:type/:lang")
  saveTemplate(@Param() p: unknown, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    const { type, lang } = templateKey.parse(p);
    return this.reports.saveTemplate(a, type, lang, templateSchema.parse(b), clientIp(r));
  }

  @RequirePermission("certificates:issue") @Post("certificates")
  async issue(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request, @Res() res: Response) {
    sendPdf(res, await this.reports.issue(a, issueSchema.parse(b), clientIp(r)));
  }

  @RequirePermission("certificates:issue") @Post("certificates/section")
  async issueSection(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request, @Res() res: Response) {
    sendPdf(res, await this.reports.issueForSection(a, bulkIssueSchema.parse(b), clientIp(r)));
  }

  @RequirePermission("certificates:issue") @Get("students/:userId/certificates")
  issuedTo(@Param("userId") u: string, @CurrentActor() a: Actor) { return this.reports.issuedTo(a, id.parse(u)); }

  @RequirePermission("reports:manage") @Get("certificates/:serial")
  async reprint(@Param("serial") raw: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendPdf(res, await this.reports.reprint(a, serial.parse(raw)));
  }

  @RequirePermission("certificates:issue") @Post("certificates/:serial/revoke")
  revoke(@Param("serial") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.reports.revoke(a, serial.parse(raw), noteSchema.parse(b).note, clientIp(r));
  }
}
