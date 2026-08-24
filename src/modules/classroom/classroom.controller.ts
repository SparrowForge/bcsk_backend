import { Body, Controller, Get, Post } from "@nestjs/common";
import { z } from "zod";
import { ClassroomService } from "./classroom.service";
import { CurrentActor, Public } from "@/common/decorators/actor.decorator";
import { forbidden } from "@/common/errors/app-error";
import type { Actor, MaybeActor } from "@/common/actor";
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
@Controller("classroom")
export class ClassroomController {
  constructor(private readonly classroom: ClassroomService) {}

  private student(actor: Actor): Actor {
    if (actor.role !== "STUDENT") throw forbidden("This area is for students.");
    return actor;
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

  @Get("assignments")
  assignments(@CurrentActor() a: Actor) { return this.classroom.assignments(this.student(a)); }

  @Post("assignments/submit")
  submit(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = submit.parse(body);
    return this.classroom.submitAssignment(this.student(a), input.assignmentId, input.text ?? null, input.filePath ?? null);
  }

  @Get("results")
  results(@CurrentActor() a: Actor) { return this.classroom.results(this.student(a)); }

  @Get("attendance")
  attendance(@CurrentActor() a: Actor) { return this.classroom.attendance(this.student(a)); }

  @Get("routine")
  routine(@CurrentActor() a: Actor) { return this.classroom.routine(this.student(a)); }

  @Get("videos")
  videos(@CurrentActor() a: Actor) { return this.classroom.videos(this.student(a)); }

  @Get("teachers")
  teachers(@CurrentActor() a: Actor) {
    this.student(a);
    return this.classroom.teacherDirectory();
  }

  @Get("syllabus")
  syllabus(@CurrentActor() a: Actor) { return this.classroom.syllabus(this.student(a)); }

  @Get("re-admission")
  reAdmission(@CurrentActor() a: Actor) { return this.classroom.reAdmissionInfo(this.student(a)); }

  @Post("re-admission")
  submitReAdmission(@Body() body: unknown, @CurrentActor() a: Actor) {
    const { receiptPath } = z.object({ receiptPath: z.string().min(1) }).parse(body);
    return this.classroom.submitReAdmission(this.student(a), receiptPath);
  }

  @Get("questions")
  questions(@CurrentActor() a: Actor) { return this.classroom.questions(this.student(a)); }

  @Post("questions")
  ask(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = ask.parse(body);
    return this.classroom.askTeacher(this.student(a), input.teacherUserId, input.subject, input.body);
  }
}
