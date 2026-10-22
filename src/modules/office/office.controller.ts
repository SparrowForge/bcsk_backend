import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Res } from "@nestjs/common";
import { z } from "zod";
import { OfficeService } from "./office.service";
import { RoutineService } from "../schedule/routine.service";
import { OnlineClassService } from "../schedule/online-class.service";
import { cancelClassSchema, endClassSchema, onlineClassSchema, rangeSchema } from "../schedule/schedule.schema";
import { AttendanceReportService } from "../teaching/attendance-report.service";
import { MaterialService } from "../teaching/material.service";
import { teacherMaterialSchema } from "../teaching/material.schema";
import { MarksService } from "../exam/marks.service";
import { ResultService } from "../result/result.service";
import { ReportService } from "../result/report.service";
import { sendCsv, sendPdf } from "../result/result.controller";
import { LeaveService } from "../application/leave.service";
import { reviewSchema, statusFilter } from "../application/application.schema";
import type { Response } from "express";
import { marksSchema } from "../exam/exam.schema";
import { CurrentActor, RequireMenu, Roles } from "../../common/decorators/actor.decorator";
import { forbidden } from "../../common/errors/app-error";
import type { Actor } from "../../common/actor";

const idParam = z.coerce.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const attendance = z.object({
  date: day,
  entries: z.array(z.object({
    studentUserId: z.number().int(),
    status: z.string(),
    remark: z.string().trim().max(200).optional().nullable(),
  })).max(300),
});
const deskStatusInput = z.object({
  status: z.enum(["DESK", "OFFLINE"]),
  returnAt: z.string().min(1).optional(),
});
const assignment = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  filePath: z.string().optional(),
  maxMarks: z.coerce.number().int().min(1).max(1000).optional().nullable(),
});
const gradeInput = z.object({
  grade: z.string().trim().max(40).optional().nullable(),
  marks: z.coerce.number().min(0).max(1000).optional().nullable(),
  feedback: z.string().max(2000).optional().nullable(),
});

/** Teacher-only. */
@Roles("TEACHER")
@Controller("office")
export class OfficeController {
  constructor(
    private readonly office: OfficeService,
    private readonly routine: RoutineService,
    private readonly online: OnlineClassService,
    private readonly attendanceReports: AttendanceReportService,
    private readonly materials: MaterialService,
    private readonly marks: MarksService,
    private readonly results: ResultService,
    private readonly reports: ReportService,
    private readonly leave: LeaveService,
  ) {}

  /* LMS B6: leave of the sections this teacher is class teacher of. */
  @RequireMenu("office.classes")
  @Get("leave")
  leaveQueue(@Query() q: unknown, @CurrentActor() a: Actor) {
    return this.leave.teacherQueue(this.teacher(a), statusFilter.parse(q).status);
  }

  @RequireMenu("office.classes", "update")
  @Post("leave/:id/review")
  reviewLeave(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { recommendation, note } = reviewSchema.parse(body);
    return this.leave.review(this.teacher(a), idParam.parse(raw), recommendation, note);
  }

  /* LMS B5: results of the teacher's own sections, once processed. */
  @RequireMenu("office.classes")
  @Get("results/exams/:examId/sections/:sectionId")
  sectionResults(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor) {
    return this.results.sectionReport(this.teacher(a), idParam.parse(e), idParam.parse(s));
  }

  @RequireMenu("office.classes")
  @Get("results/exams/:examId/sections/:sectionId/tabulation.pdf")
  async tabulation(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendPdf(res, await this.reports.tabulation(this.teacher(a), idParam.parse(e), idParam.parse(s)));
  }

  @RequireMenu("office.classes")
  @Get("results/exams/:examId/sections/:sectionId/tabulation.csv")
  async tabulationCsv(@Param("examId") e: string, @Param("sectionId") s: string, @CurrentActor() a: Actor, @Res() res: Response) {
    sendCsv(res, await this.reports.tabulationCsv(this.teacher(a), idParam.parse(e), idParam.parse(s)));
  }

  /** One student's results across exams - a student the teacher teaches now. */
  @RequireMenu("office.classes")
  @Get("students/:userId/performance")
  studentPerformance(@Param("userId") u: string, @CurrentActor() a: Actor) {
    return this.results.studentPerformance(this.teacher(a), idParam.parse(u));
  }

  /* LMS B4: the papers this teacher marks, and the marks grid of one section. */
  @RequireMenu("office.classes")
  @Get("exams")
  examPapers(@CurrentActor() a: Actor) { return this.marks.teacherPapers(this.teacher(a)); }

  @RequireMenu("office.classes")
  @Get("papers/:id/sections/:sectionId/marks")
  marksGrid(@Param("id") raw: string, @Param("sectionId") rawSection: string, @CurrentActor() a: Actor) {
    return this.marks.teacherGrid(this.teacher(a), idParam.parse(raw), idParam.parse(rawSection));
  }

  /** Entering marks is writing new records: the Insert switch, though the method is PUT. */
  @RequireMenu("office.classes", "insert")
  @Put("papers/:id/sections/:sectionId/marks")
  saveMarks(@Param("id") raw: string, @Param("sectionId") rawSection: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.marks.save(this.teacher(a), idParam.parse(raw), idParam.parse(rawSection), marksSchema.parse(body).entries);
  }

  @RequireMenu("office.classes")
  @Post("papers/:id/sections/:sectionId/submit")
  submitMarks(@Param("id") raw: string, @Param("sectionId") rawSection: string, @CurrentActor() a: Actor) {
    return this.marks.submit(this.teacher(a), idParam.parse(raw), idParam.parse(rawSection));
  }

  /* LMS B3: section attendance report and course materials. */
  @RequireMenu("office.classes")
  @Get("sections/:id/attendance-report")
  sectionAttendance(@Param("id") raw: string, @Query() q: unknown, @CurrentActor() a: Actor) {
    return this.attendanceReports.forTeacherSection(this.teacher(a), idParam.parse(raw), rangeSchema.parse(q));
  }

  @RequireMenu("office.classes")
  @Get("materials")
  materialList(@CurrentActor() a: Actor) { return this.materials.teacherList(this.teacher(a)); }

  @RequireMenu("office.classes")
  @Post("sections/:id/materials")
  materialCreate(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.materials.teacherCreate(this.teacher(a), idParam.parse(raw), teacherMaterialSchema.parse(body));
  }

  @RequireMenu("office.classes")
  @Patch("materials/:id")
  materialUpdate(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.materials.teacherUpdate(this.teacher(a), idParam.parse(raw), teacherMaterialSchema.parse(body));
  }

  @RequireMenu("office.classes", "update")
  @Delete("materials/:id")
  materialDelete(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.materials.teacherDelete(this.teacher(a), idParam.parse(raw));
  }

  private teacher(actor: Actor): Actor {
    if (actor.role !== "TEACHER") throw forbidden("This area is for teachers.");
    return actor;
  }

  /* LMS B2: the teacher's week and their online classes. */
  @RequireMenu("office.classes")
  @Get("routine")
  routineWeek(@CurrentActor() a: Actor) { return this.routine.teacherWeek(this.teacher(a)); }

  @RequireMenu("office.classes")
  @Get("online-classes")
  onlineClasses(@Query() q: unknown, @CurrentActor() a: Actor) {
    return this.online.mine(this.teacher(a), rangeSchema.parse(q));
  }

  @RequireMenu("office.classes")
  @Post("classes/:id/online-classes")
  scheduleOnline(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.online.schedule(this.teacher(a), idParam.parse(raw), onlineClassSchema.parse(body));
  }

  @RequireMenu("office.classes", "update")
  @Post("online-classes/:id/start")
  startOnline(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.online.start(this.teacher(a), idParam.parse(raw));
  }

  @RequireMenu("office.classes", "update")
  @Post("online-classes/:id/end")
  endOnline(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.online.end(this.teacher(a), idParam.parse(raw), endClassSchema.parse(body ?? {}).recordingUrl);
  }

  @RequireMenu("office.classes", "update")
  @Post("online-classes/:id/cancel")
  cancelOnline(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.online.cancel(this.teacher(a), idParam.parse(raw), cancelClassSchema.parse(body ?? {}).reason);
  }

  @RequireMenu("office.classes")
  @Get("online-classes/:id/joins")
  onlineJoins(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.online.joins(this.teacher(a), idParam.parse(raw));
  }

  @Get("dashboard")
  dashboard(@CurrentActor() a: Actor) { return this.office.dashboard(this.teacher(a)); }

  @RequireMenu("office.guardians")
  @Get("guardians")
  guardians(@CurrentActor() a: Actor) { return this.office.guardians(this.teacher(a)); }

  @RequireMenu("office.classes")
  @Get("classes")
  classes(@CurrentActor() a: Actor) { return this.office.myClasses(this.teacher(a)); }

  /** LMS B1: the sections this teacher teaches or leads this term. */
  @RequireMenu("office.classes")
  @Get("sections")
  sections(@CurrentActor() a: Actor) { return this.office.mySections(this.teacher(a)); }

  @RequireMenu("office.classes")
  @Get("sections/:id/students")
  roster(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.office.sectionRoster(this.teacher(a), idParam.parse(raw));
  }

  @RequireMenu("office.classes")
  @Get("classes/:id")
  detail(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.office.classDetail(this.teacher(a), idParam.parse(raw));
  }

  @RequireMenu("office.classes")
  @Patch("classes/:id/live")
  live(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { live, zoomLink } = z.object({ live: z.boolean(), zoomLink: z.string().optional() }).parse(body);
    return this.office.toggleLive(this.teacher(a), idParam.parse(raw), live, zoomLink);
  }

  /** The teacher's own desk presence on the homepage office board. */
  @Patch("desk-status")
  deskStatus(@Body() body: unknown, @CurrentActor() a: Actor) {
    const { status, returnAt } = deskStatusInput.parse(body);
    return this.office.setDeskStatus(this.teacher(a), status, returnAt ?? null);
  }

  @RequireMenu("office.classes")
  @Post("classes/:id/attendance")
  attendance(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const input = attendance.parse(body);
    return this.office.markAttendance(this.teacher(a), idParam.parse(raw), input.date, input.entries);
  }

  @RequireMenu("office.classes")
  @Post("classes/:id/assignments")
  postAssignment(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.office.postAssignment(this.teacher(a), idParam.parse(raw), assignment.parse(body));
  }

  /* LMS B3: correct or remove an assignment; attendance for any past day. */
  @RequireMenu("office.classes")
  @Patch("assignments/:id")
  updateAssignment(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.office.updateAssignment(this.teacher(a), idParam.parse(raw), assignment.parse(body));
  }

  @RequireMenu("office.classes", "update")
  @Delete("assignments/:id")
  deleteAssignment(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.office.deleteAssignment(this.teacher(a), idParam.parse(raw));
  }

  @RequireMenu("office.classes")
  @Get("classes/:id/attendance")
  attendanceSheet(@Param("id") raw: string, @Query("date") date: unknown, @CurrentActor() a: Actor) {
    return this.office.attendanceSheet(this.teacher(a), idParam.parse(raw), day.parse(date));
  }

  @RequireMenu("office.classes")
  @Post("classes/:id/videos")
  addVideo(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { title, videoUrl } = z.object({ title: z.string().min(1), videoUrl: z.string().min(1) }).parse(body);
    return this.office.addVideo(this.teacher(a), idParam.parse(raw), title, videoUrl);
  }

  @RequireMenu("office.classes")
  @Post("submissions/:id/grade")
  grade(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.office.gradeSubmission(this.teacher(a), idParam.parse(raw), gradeInput.parse(body));
  }

  @RequireMenu("office.questions")
  @Get("questions")
  questions(@CurrentActor() a: Actor) { return this.office.questions(this.teacher(a)); }

  @RequireMenu("office.questions")
  @Post("questions/:id/answer")
  answer(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { answer } = z.object({ answer: z.string().trim().min(1) }).parse(body);
    return this.office.answerQuestion(this.teacher(a), idParam.parse(raw), answer);
  }

  @RequireMenu("office.tasks")
  @Get("tasks")
  tasks(@CurrentActor() a: Actor) { return this.office.tasks(this.teacher(a)); }

  @RequireMenu("office.tasks")
  @Patch("tasks/:id")
  toggleTask(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { done } = z.object({ done: z.boolean() }).parse(body);
    return this.office.toggleTask(this.teacher(a), idParam.parse(raw), done);
  }
}
