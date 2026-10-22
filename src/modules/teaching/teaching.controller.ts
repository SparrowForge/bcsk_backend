import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AttendanceReportService } from "./attendance-report.service";
import { MaterialService } from "./material.service";
import { managedMaterialSchema, materialFilter } from "./material.schema";
import { rangeSchema } from "../schedule/schedule.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import { clientIp } from "../../common/client-ip";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

/** The Head Master's attendance monitor and course-material library. */
@Roles(...ADMIN_ROLES)
@Controller()
export class TeachingController {
  constructor(
    private readonly attendance: AttendanceReportService,
    private readonly materials: MaterialService,
  ) {}

  @RequirePermission("attendance:record") @Get("attendance/overview")
  overview(@Query("date") date: unknown, @CurrentActor() a: Actor) { return this.attendance.overview(a, day.parse(date)); }

  @RequirePermission("attendance:record") @Get("attendance/sections/:id")
  sectionReport(@Param("id") raw: string, @Query() q: unknown, @CurrentActor() a: Actor) {
    return this.attendance.forSection(a, id.parse(raw), rangeSchema.parse(q));
  }

  @RequirePermission("materials:manage") @Get("materials")
  list(@Query() q: unknown, @CurrentActor() a: Actor) { return this.materials.manageList(a, materialFilter.parse(q)); }

  @RequirePermission("materials:manage") @Post("materials")
  create(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.materials.manageCreate(a, managedMaterialSchema.parse(b), clientIp(r));
  }

  @RequirePermission("materials:manage") @Patch("materials/:id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.materials.manageUpdate(a, id.parse(raw), managedMaterialSchema.parse(b), clientIp(r));
  }

  @RequirePermission("materials:manage") @Delete("materials/:id")
  remove(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.materials.manageDelete(a, id.parse(raw), clientIp(r));
  }
}
