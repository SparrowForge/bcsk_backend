import { Body, Controller, Get, Param, Post, Query, Res } from "@nestjs/common";
import { z } from "zod";
import { ClassroomService } from "./classroom.service";
import { OnlineClassService } from "../schedule/online-class.service";
import { AttendanceReportService } from "../teaching/attendance-report.service";
import { MaterialService } from "../teaching/material.service";
import { MarksService } from "../exam/marks.service";
import { ResultService } from "../result/result.service";
import { ReportService } from "../result/report.service";
import { sendPdf } from "../result/result.controller";
import { LeaveService } from "../application/leave.service";
import { TransferService } from "../application/transfer.service";
import { leaveSchema, transferSchema } from "../application/application.schema";
import type { Response } from "express";
import { CurrentActor, Public, RequireMenu, Roles } from "../../common/decorators/actor.decorator";
import { forbidden } from "../../common/errors/app-error";
import type { Actor, MaybeActor } from "../../common/actor";
import type { Request } from "express";
import { Req } from "@nestjs/common";

const submit = z.object({
  assignmentId: z.coerce.number().int().positive(),
  text: z.string().trim().optional(),
  filePath: z.string().optional(),
});
const ask = z.object({
  teacherUserId: z.coerce.number().int().positive(),
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

/** Student-only. Every method scopes to the caller's own records. */
@Roles("STUDENT")
@Controller("classroom")
export class ClassroomController {
  constructor(
    private readonly classroom: ClassroomService,
    private readonly online: OnlineClassService,
    private readonly attendanceReports: AttendanceReportService,
    private readonly materials: MaterialService,
    private readonly marks: MarksService,
    private readonly resultService: ResultService,
    private readonly reports: ReportService,
    private readonly leave: LeaveService,
    private readonly transfers: TransferService,
  ) {}

  /*
   * LMS B6: the student's leave and transfer applications. They sit under the Documents menu
   * (Account) with the Access switch - applying is a request to the school, not a page of its own
   * yet - so no new sidebar link appears before the frontend pages exist.
   */
  @RequireMenu("classroom.documents")
  @Get("leave")
  myLeave(@CurrentActor() a: Actor) { return this.leave.mine(this.student(a)); }

  @RequireMenu("classroom.documents", "access")
  @Post("leave")
  applyLeave(@Body() body: unknown, @CurrentActor() a: Actor) { return this.leave.apply(this.student(a), leaveSchema.parse(body)); }

  @RequireMenu("classroom.documents", "access")
  @Post("leave/:id/cancel")
  cancelLeave(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.leave.cancel(this.student(a), z.coerce.number().int().positive().parse(raw));
  }

  @RequireMenu("classroom.documents")
  @Get("transfers")
  myTransfers(@CurrentActor() a: Actor) { return this.transfers.mine(this.student(a)); }

  @RequireMenu("classroom.documents", "access")
  @Post("transfers")
  applyTransfer(@Body() body: unknown, @CurrentActor() a: Actor) { return this.transfers.apply(this.student(a), transferSchema.parse(body)); }

  @RequireMenu("classroom.documents", "access")
  @Post("transfers/:id/cancel")
  cancelTransfer(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.transfers.cancel(this.student(a), z.coerce.number().int().positive().parse(raw));
  }

  @RequireMenu("classroom.documents")
  @Get("transfers/letter")
  async transferLetter(@CurrentActor() a: Actor, @Res() res: Response) {
    sendPdf(res, await this.transfers.letter(this.student(a)));
  }

  /* LMS B5: published exam results, mark sheets and issued certificates - the student's own only. */
  @RequireMenu("classroom.results")
  @Get("exam-results")
  examResults(@CurrentActor() a: Actor) { return this.resultService.publishedForStudent(this.student(a)); }

  @RequireMenu("classroom.results")
  @Get("exam-results/:examId/mark-sheet")
  async markSheet(@Param("examId") raw: string, @CurrentActor() a: Actor, @Res() res: Response) {
    const s = this.student(a);
    sendPdf(res, await this.reports.markSheet(s, z.coerce.number().int().positive().parse(raw), s.userId));
  }

  @RequireMenu("classroom.documents")
  @Get("certificates")
  certificates(@CurrentActor() a: Actor) { return this.reports.issued(this.student(a)); }

  @RequireMenu("classroom.documents")
  @Get("certificates/:serial")
  async certificate(@Param("serial") raw: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendPdf(res, await this.reports.reprint(this.student(a), z.string().trim().max(60).regex(/^[A-Z0-9-]+$/).parse(raw)));
  }

  /** LMS B4: the published exam schedule for the student's classes. */
  @RequireMenu("classroom.routine")
  @Get("exams")
  exams(@CurrentActor() a: Actor) { return this.marks.studentSchedule(this.student(a)); }

  /* LMS B3: own attendance summary and course materials. */
  @RequireMenu("classroom.attendance")
  @Get("attendance/summary")
  attendanceSummary(@CurrentActor() a: Actor) { return this.attendanceReports.forStudent(this.student(a)); }

  @RequireMenu("classroom.syllabus")
  @Get("materials")
  materialList(@Query("subjectId") raw: unknown, @CurrentActor() a: Actor) {
    const subjectId = raw == null || raw === "" ? undefined : z.coerce.number().int().positive().parse(raw);
    return this.materials.studentList(this.student(a), subjectId);
  }

  private student(actor: Actor): Actor {
    if (actor.role !== "STUDENT") throw forbidden("This area is for students.");
    return actor;
  }

  /* LMS B2: the student's online classes; the link comes only from joining. */
  @RequireMenu("classroom.routine")
  @Get("online-classes")
  onlineClasses(@CurrentActor() a: Actor) { return this.online.upcoming(this.student(a)); }

  /** A POST because it logs the join, but it is reading the class: the Access switch. */
  @RequireMenu("classroom.routine", "access")
  @Post("online-classes/:id/join")
  joinOnline(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.online.join(this.student(a), z.coerce.number().int().positive().parse(raw));
  }

  /**
   * Public: course pages show a BCSK-student price to enrolled visitors and the standard
   * price to everyone else, so this must answer for anonymous callers rather than reject them.
   */
  @Public()
  @Get("enrolled-courses")
  enrolled(@Req() req: Request & { actor?: Actor }) {
    return this.classroom.enrolledCourseSlugs(req.actor ?? null);
  }

  @Public()
  @Post("game-score")
  gameScore(@Body() body: unknown, @Req() req: Request & { actor?: Actor }) {
    const input = z.object({
      game: z.string().min(1),
      level: z.coerce.number().int().min(0).default(0),
      score: z.coerce.number().int().min(0),
    }).parse(body);
    return this.classroom.recordGameScore(req.actor ?? null, input.game, input.level, input.score);
  }

  @Public()
  @Post("practice-score")
  practiceScore(@Body() body: unknown, @Req() req: Request & { actor?: Actor }) {
    const input = z.object({
      score: z.coerce.number().int().min(0),
      total: z.coerce.number().int().min(1),
    }).parse(body);
    return this.classroom.recordPracticeScore(req.actor ?? null, input.score, input.total);
  }

  @Get("dashboard")
  dashboard(@CurrentActor() a: Actor) { return this.classroom.dashboard(this.student(a)); }

  @RequireMenu("classroom.assignments")
  @Get("assignments")
  assignments(@CurrentActor() a: Actor) { return this.classroom.assignments(this.student(a)); }

  @RequireMenu("classroom.assignments")
  @Post("assignments/submit")
  submit(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = submit.parse(body);
    return this.classroom.submitAssignment(this.student(a), input.assignmentId, input.text ?? null, input.filePath ?? null);
  }

  @RequireMenu("classroom.results")
  @Get("results")
  results(@CurrentActor() a: Actor) { return this.classroom.results(this.student(a)); }

  @RequireMenu("classroom.attendance")
  @Get("attendance")
  attendance(@CurrentActor() a: Actor) { return this.classroom.attendance(this.student(a)); }

  /** LMS B1: the student's class, section, roll number and subjects this term. */
  @RequireMenu("classroom.routine")
  @Get("sections")
  sections(@CurrentActor() a: Actor) { return this.classroom.mySections(this.student(a)); }

  @RequireMenu("classroom.routine")
  @Get("routine")
  routine(@CurrentActor() a: Actor) { return this.classroom.routine(this.student(a)); }

  @RequireMenu("classroom.videos")
  @Get("videos")
  videos(@CurrentActor() a: Actor) { return this.classroom.videos(this.student(a)); }

  @RequireMenu("classroom.ask-teacher")
  @Get("teachers")
  teachers(@CurrentActor() a: Actor) {
    this.student(a);
    return this.classroom.teacherDirectory();
  }

  @RequireMenu("classroom.syllabus")
  @Get("syllabus")
  syllabus(@CurrentActor() a: Actor) { return this.classroom.syllabus(this.student(a)); }

  @RequireMenu("classroom.re-admission")
  @Get("re-admission")
  reAdmission(@CurrentActor() a: Actor) { return this.classroom.reAdmissionInfo(this.student(a)); }

  @RequireMenu("classroom.re-admission")
  @Post("re-admission")
  submitReAdmission(@Body() body: unknown, @CurrentActor() a: Actor) {
    const { receiptPath } = z.object({ receiptPath: z.string().min(1) }).parse(body);
    return this.classroom.submitReAdmission(this.student(a), receiptPath);
  }

  @RequireMenu("classroom.ask-teacher")
  @Get("questions")
  questions(@CurrentActor() a: Actor) { return this.classroom.questions(this.student(a)); }

  @RequireMenu("classroom.ask-teacher")
  @Post("questions")
  ask(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = ask.parse(body);
    return this.classroom.askTeacher(this.student(a), input.teacherUserId, input.subject, input.body);
  }
}
