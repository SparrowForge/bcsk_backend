import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { AcademicService } from "./academic.service";
import { academicClassSchema, classSubjectSchema } from "./academic.schema";
import { CurrentActor, Public, RequirePermission } from "../../common/decorators/actor.decorator";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,40}$/);

/** Academic > All General Classes: public reads, and the admin screens that write them. */
@Controller("academic")
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}

  @Public() @Get("classes")
  classes() { return this.academic.publicClasses(); }

  @Public() @Get("classes/:slug")
  classPage(@Param("slug") raw: string) { return this.academic.publicClass(slug.parse(raw)); }

  @RequirePermission("courses:manage") @Get("admin/classes")
  adminClasses() { return this.academic.adminClasses(); }

  @RequirePermission("courses:manage") @Get("admin/classes/:id")
  adminClass(@Param("id") raw: string) { return this.academic.adminClass(id.parse(raw)); }

  @RequirePermission("courses:manage") @Post("admin/classes")
  createClass(@Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.academic.createClass(academicClassSchema.parse(b), actor);
  }

  @RequirePermission("courses:manage") @Patch("admin/classes/:id")
  updateClass(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.academic.updateClass(id.parse(raw), academicClassSchema.parse(b), actor);
  }

  @RequirePermission("courses:manage") @Delete("admin/classes/:id")
  deleteClass(@Param("id") raw: string, @CurrentActor() actor: Actor) {
    return this.academic.deleteClass(id.parse(raw), actor);
  }

  @RequirePermission("courses:manage") @Post("admin/classes/:id/subjects")
  addSubject(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.academic.addSubject(id.parse(raw), classSubjectSchema.parse(b), actor);
  }

  @RequirePermission("courses:manage") @Patch("admin/subjects/:id")
  updateSubject(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.academic.updateSubject(id.parse(raw), classSubjectSchema.parse(b), actor);
  }

  @RequirePermission("courses:manage") @Delete("admin/subjects/:id")
  deleteSubject(@Param("id") raw: string, @CurrentActor() actor: Actor) {
    return this.academic.deleteSubject(id.parse(raw), actor);
  }
}
