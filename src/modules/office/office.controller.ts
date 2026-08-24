import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { OfficeService } from "./office.service";
import { CurrentActor } from "@/common/decorators/actor.decorator";
import { forbidden } from "@/common/errors/app-error";
import type { Actor } from "@/common/actor";

const idParam = z.coerce.number().int().positive();
const attendance = z.object({
  date: z.string().min(8),
  entries: z.array(z.object({ studentUserId: z.number().int(), status: z.string() })),
});
const assignment = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  filePath: z.string().optional(),
});

/** Teacher-only. */
@Controller("office")
export class OfficeController {
  constructor(private readonly office: OfficeService) {}

  private teacher(actor: Actor): Actor {
    if (actor.role !== "TEACHER") throw forbidden("This area is for teachers.");
    return actor;
  }

  @Get("dashboard")
  dashboard(@CurrentActor() a: Actor) { return this.office.dashboard(this.teacher(a)); }

  @Get("guardians")
  guardians(@CurrentActor() a: Actor) { return this.office.guardians(this.teacher(a)); }

  @Get("classes")
  classes(@CurrentActor() a: Actor) { return this.office.myClasses(this.teacher(a)); }

  @Get("classes/:id")
  detail(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.office.classDetail(this.teacher(a), idParam.parse(raw));
  }

  @Patch("classes/:id/live")
  live(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { live, zoomLink } = z.object({ live: z.boolean(), zoomLink: z.string().optional() }).parse(body);
    return this.office.toggleLive(this.teacher(a), idParam.parse(raw), live, zoomLink);
  }

  @Post("classes/:id/attendance")
  attendance(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const input = attendance.parse(body);
    return this.office.markAttendance(this.teacher(a), idParam.parse(raw), input.date, input.entries);
  }

  @Post("classes/:id/assignments")
  postAssignment(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.office.postAssignment(this.teacher(a), idParam.parse(raw), assignment.parse(body));
  }

  @Post("classes/:id/videos")
  addVideo(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { title, videoUrl } = z.object({ title: z.string().min(1), videoUrl: z.string().min(1) }).parse(body);
    return this.office.addVideo(this.teacher(a), idParam.parse(raw), title, videoUrl);
  }

  @Post("submissions/:id/grade")
  grade(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { grade, feedback } = z.object({ grade: z.string().min(1), feedback: z.string().optional() }).parse(body);
    return this.office.gradeSubmission(this.teacher(a), idParam.parse(raw), grade, feedback);
  }

  @Get("questions")
  questions(@CurrentActor() a: Actor) { return this.office.questions(this.teacher(a)); }

  @Post("questions/:id/answer")
  answer(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { answer } = z.object({ answer: z.string().trim().min(1) }).parse(body);
    return this.office.answerQuestion(this.teacher(a), idParam.parse(raw), answer);
  }

  @Get("tasks")
  tasks(@CurrentActor() a: Actor) { return this.office.tasks(this.teacher(a)); }

  @Patch("tasks/:id")
  toggleTask(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { done } = z.object({ done: z.boolean() }).parse(body);
    return this.office.toggleTask(this.teacher(a), idParam.parse(raw), done);
  }
}
