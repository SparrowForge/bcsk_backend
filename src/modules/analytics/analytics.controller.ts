import { Controller, Get, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { AnalyticsService } from "./analytics.service";
import { rangeSchema } from "../schedule/schedule.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import type { Actor } from "../../common/actor";

/** The Head Master's dashboard and reports (`analytics:read`). */
@Roles(...ADMIN_ROLES)
@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @RequirePermission("analytics:read") @Get("overview")
  overview(@CurrentActor() a: Actor) { return this.analytics.overview(a); }

  @RequirePermission("analytics:read") @Get("attendance")
  attendance(@Query() q: unknown, @CurrentActor() a: Actor) { return this.analytics.attendanceBySection(a, rangeSchema.parse(q)); }

  @RequirePermission("analytics:read") @Get("exams/:examId")
  exam(@Param("examId") raw: string, @CurrentActor() a: Actor) {
    return this.analytics.examResults(a, z.coerce.number().int().positive().parse(raw));
  }
}
