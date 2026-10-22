import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { ExamService } from "./exam.service";
import { GradingService } from "./grading.service";
import { MarksService } from "./marks.service";
import { examFilter, examSchema, examUpdateSchema, paperSchema, paperUpdateSchema, reopenSchema, schemeSchema } from "./exam.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import { clientIp } from "../../common/client-ip";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();

/** Exams and grading schemes on the admin panel (Head Master: `exams:manage`). */
@Roles(...ADMIN_ROLES)
@Controller()
export class ExamController {
  constructor(
    private readonly exams: ExamService,
    private readonly grading: GradingService,
    private readonly marks: MarksService,
  ) {}

  /* grading schemes */
  @RequirePermission("exams:manage") @Get("grading-schemes")
  schemes(@CurrentActor() a: Actor) { return this.grading.list(a); }

  @RequirePermission("exams:manage") @Post("grading-schemes")
  createScheme(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.grading.create(a, schemeSchema.parse(b), clientIp(r));
  }

  @RequirePermission("exams:manage") @Patch("grading-schemes/:id")
  updateScheme(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.grading.update(a, id.parse(raw), schemeSchema.parse(b), clientIp(r));
  }

  /* exams */
  @RequirePermission("exams:manage") @Get("exams")
  list(@Query() q: unknown, @CurrentActor() a: Actor) { return this.exams.list(a, examFilter.parse(q).termId); }

  @RequirePermission("exams:manage") @Get("exams/:id")
  detail(@Param("id") raw: string, @CurrentActor() a: Actor) { return this.exams.detail(a, id.parse(raw)); }

  @RequirePermission("exams:manage") @Post("exams")
  create(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.create(a, examSchema.parse(b), clientIp(r));
  }

  @RequirePermission("exams:manage") @Patch("exams/:id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.update(a, id.parse(raw), examUpdateSchema.parse(b), clientIp(r));
  }

  @RequirePermission("exams:manage") @Delete("exams/:id")
  remove(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.remove(a, id.parse(raw), clientIp(r));
  }

  @RequirePermission("exams:manage") @Post("exams/:id/publish")
  publish(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.publish(a, id.parse(raw), clientIp(r));
  }

  @RequirePermission("exams:manage") @Post("exams/:id/cancel")
  cancel(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.cancel(a, id.parse(raw), clientIp(r));
  }

  /* papers */
  @RequirePermission("exams:manage") @Post("exams/:id/papers")
  addPaper(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.addPaper(a, id.parse(raw), paperSchema.parse(b), clientIp(r));
  }

  @RequirePermission("exams:manage") @Patch("papers/:id")
  updatePaper(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.updatePaper(a, id.parse(raw), paperUpdateSchema.parse(b), clientIp(r));
  }

  @RequirePermission("exams:manage") @Delete("papers/:id")
  removePaper(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.removePaper(a, id.parse(raw), clientIp(r));
  }

  /* marks: read-only to the Head Master, plus reopening a submitted sheet */
  @RequirePermission("exams:manage") @Get("papers/:id/sections/:sectionId/marks")
  marksGrid(@Param("id") raw: string, @Param("sectionId") rawSection: string, @CurrentActor() a: Actor) {
    return this.marks.managerGrid(a, id.parse(raw), id.parse(rawSection));
  }

  @RequirePermission("exams:manage") @Post("papers/:id/sections/:sectionId/reopen")
  reopen(@Param("id") raw: string, @Param("sectionId") rawSection: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.exams.reopen(a, id.parse(raw), id.parse(rawSection), reopenSchema.parse(b).reason, clientIp(r));
  }
}
