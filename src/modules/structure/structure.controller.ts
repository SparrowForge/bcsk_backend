import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { StructureService } from "./structure.service";
import {
  batchSchema, courseDepartmentSchema, curriculumSchema, departmentSchema, enrollmentUpdateSchema,
  placeStudentSchema, sectionFilter, sectionSchema, sectionUpdateSchema, studentFilter, subjectSchema,
  teacherAssignmentSchema, termSchema,
} from "./structure.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import { clientIp } from "../../common/client-ip";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();

/**
 * The academic structure screens of the admin panel (Head Master, and staff granted the same
 * capabilities). Teachers read their own sections through the office panel instead.
 */
@Roles(...ADMIN_ROLES)
@Controller("structure")
export class StructureController {
  constructor(private readonly structure: StructureService) {}

  /* departments */
  @RequirePermission("departments:manage") @Get("departments")
  departments(@CurrentActor() a: Actor) { return this.structure.departments(a); }

  @RequirePermission("departments:manage") @Post("departments")
  createDepartment(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.createDepartment(a, departmentSchema.parse(b), clientIp(r));
  }

  @RequirePermission("departments:manage") @Patch("departments/:id")
  updateDepartment(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.updateDepartment(a, id.parse(raw), departmentSchema.parse(b), clientIp(r));
  }

  @RequirePermission("departments:manage") @Delete("departments/:id")
  deleteDepartment(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.deleteDepartment(a, id.parse(raw), clientIp(r));
  }

  /* courses and their classes */
  @RequirePermission("sections:manage") @Get("levels")
  levels(@CurrentActor() a: Actor) { return this.structure.levels(a); }

  @RequirePermission("courses:manage") @Patch("courses/:id/department")
  setCourseDepartment(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.setCourseDepartment(a, id.parse(raw), courseDepartmentSchema.parse(b).departmentId, clientIp(r));
  }

  /* terms */
  @RequirePermission("sections:manage") @Get("terms")
  terms(@CurrentActor() a: Actor) { return this.structure.terms(a); }

  @RequirePermission("sections:manage") @Post("terms")
  createTerm(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.createTerm(a, termSchema.parse(b), clientIp(r));
  }

  @RequirePermission("sections:manage") @Patch("terms/:id")
  updateTerm(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.updateTerm(a, id.parse(raw), termSchema.parse(b), clientIp(r));
  }

  @RequirePermission("sections:manage") @Post("terms/:id/current")
  setCurrentTerm(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.setCurrentTerm(a, id.parse(raw), clientIp(r));
  }

  @RequirePermission("sections:manage") @Delete("terms/:id")
  deleteTerm(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.deleteTerm(a, id.parse(raw), clientIp(r));
  }

  /* batches */
  @RequirePermission("sections:manage") @Get("batches")
  batches(@Query() q: unknown, @CurrentActor() a: Actor) {
    return this.structure.batches(a, sectionFilter.parse(q).termId);
  }

  @RequirePermission("sections:manage") @Post("batches")
  createBatch(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.createBatch(a, batchSchema.parse(b), clientIp(r));
  }

  @RequirePermission("sections:manage") @Delete("batches/:id")
  deleteBatch(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.deleteBatch(a, id.parse(raw), clientIp(r));
  }

  /* sections */
  @RequirePermission("sections:manage") @Get("sections")
  sections(@Query() q: unknown, @CurrentActor() a: Actor) {
    return this.structure.sections(a, sectionFilter.parse(q));
  }

  @RequirePermission("sections:manage") @Get("sections/:id")
  section(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.structure.sectionDetail(a, id.parse(raw));
  }

  @RequirePermission("sections:manage") @Post("sections")
  createSection(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.createSection(a, sectionSchema.parse(b), clientIp(r));
  }

  @RequirePermission("sections:manage") @Patch("sections/:id")
  updateSection(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.updateSection(a, id.parse(raw), sectionUpdateSchema.parse(b), clientIp(r));
  }

  @RequirePermission("sections:manage") @Delete("sections/:id")
  deleteSection(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.deleteSection(a, id.parse(raw), clientIp(r));
  }

  /* students in sections */
  @RequirePermission("sections:manage") @Post("sections/:id/students")
  placeStudent(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    const input = placeStudentSchema.parse(b);
    return this.structure.placeStudent(a, id.parse(raw), input.studentUserId, input.rollNo, clientIp(r));
  }

  @RequirePermission("sections:manage") @Post("sections/:id/roll-numbers")
  rollNumbers(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.assignRollNumbers(a, id.parse(raw), clientIp(r));
  }

  @RequirePermission("sections:manage") @Patch("placements/:id")
  updatePlacement(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.updateEnrollment(a, id.parse(raw), enrollmentUpdateSchema.parse(b), clientIp(r));
  }

  /* teacher assignment */
  @RequirePermission("sections:manage") @Post("sections/:id/teachers")
  assignTeacher(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    const input = teacherAssignmentSchema.parse(b);
    return this.structure.assignTeacher(a, id.parse(raw), input.teacherProfileId, input.subjectId, clientIp(r));
  }

  @RequirePermission("sections:manage") @Delete("assignments/:id")
  unassignTeacher(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.unassignTeacher(a, id.parse(raw), clientIp(r));
  }

  /* subjects and curriculum */
  @RequirePermission("subjects:manage") @Get("subjects")
  subjects(@CurrentActor() a: Actor) { return this.structure.subjects(a); }

  @RequirePermission("subjects:manage") @Post("subjects")
  createSubject(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.createSubject(a, subjectSchema.parse(b), clientIp(r));
  }

  @RequirePermission("subjects:manage") @Patch("subjects/:id")
  updateSubject(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.updateSubject(a, id.parse(raw), subjectSchema.parse(b), clientIp(r));
  }

  @RequirePermission("subjects:manage") @Delete("subjects/:id")
  deleteSubject(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.deleteSubject(a, id.parse(raw), clientIp(r));
  }

  @RequirePermission("subjects:manage") @Get("levels/:id/subjects")
  curriculum(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.structure.curriculum(a, id.parse(raw));
  }

  @RequirePermission("subjects:manage") @Put("levels/:id/subjects/:subjectId")
  setCurriculum(@Param("id") raw: string, @Param("subjectId") rawSubject: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.setCurriculumSubject(a, id.parse(raw), id.parse(rawSubject), curriculumSchema.parse(b), clientIp(r));
  }

  @RequirePermission("subjects:manage") @Delete("levels/:id/subjects/:subjectId")
  removeCurriculum(@Param("id") raw: string, @Param("subjectId") rawSubject: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.structure.removeCurriculumSubject(a, id.parse(raw), id.parse(rawSubject), clientIp(r));
  }

  /* pickers */
  @RequirePermission("staff:read") @Get("teachers")
  teachers(@CurrentActor() a: Actor) { return this.structure.teachers(a); }

  @RequirePermission("students:read") @Get("students")
  students(@Query() q: unknown, @CurrentActor() a: Actor) {
    return this.structure.students(a, studentFilter.parse(q));
  }
}
