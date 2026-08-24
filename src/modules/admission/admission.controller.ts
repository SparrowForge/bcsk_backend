import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AdmissionService } from "./admission.service";
import { regularApplicationSchema, specialApplicationSchema } from "./admission.schema";
import { CurrentActor, Public, RequirePermission } from "@/common/decorators/actor.decorator";
import type { Actor } from "@/common/actor";

const idParam = z.coerce.number().int().positive();
const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
  status: z.string().optional(),
});

/** Best-effort client identity for rate limiting. */
function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0]!.trim();
  return req.ip ?? "unknown";
}

@Controller("admissions")
export class AdmissionController {
  constructor(private readonly admissions: AdmissionService) {}

  @Public()
  @Post("regular")
  regular(@Body() body: unknown, @Req() req: Request) {
    return this.admissions.submitRegular(regularApplicationSchema.parse(body), clientIp(req));
  }

  @Public()
  @Post("special")
  special(@Body() body: unknown, @Req() req: Request) {
    return this.admissions.submitSpecial(specialApplicationSchema.parse(body), clientIp(req));
  }

  @Public()
  @Get(":id/summary")
  summary(@Param("id") raw: string, @Query() query: unknown) {
    const { token } = z.object({ token: z.string().min(1) }).parse(query);
    return this.admissions.summaryForApplicant(idParam.parse(raw), token);
  }

  @RequirePermission("admissions:read")
  @Get()
  list(@Query() query: unknown) {
    const { cursor, limit, status } = pageQuery.parse(query);
    return this.admissions.list({ cursor, limit }, status);
  }

  @RequirePermission("admissions:read")
  @Get(":id")
  one(@Param("id") raw: string) {
    return this.admissions.getForStaff(idParam.parse(raw));
  }

  @RequirePermission("admissions:decide")
  @Post(":id/approve")
  approve(@Param("id") raw: string, @CurrentActor() actor: Actor) {
    return this.admissions.approve(idParam.parse(raw), actor);
  }

  @RequirePermission("admissions:decide")
  @Post(":id/corrections")
  corrections(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const { note } = z.object({ note: z.string().trim().min(1) }).parse(body);
    return this.admissions.requestCorrections(idParam.parse(raw), note, actor);
  }

  @RequirePermission("admissions:decide")
  @Post(":id/reject")
  reject(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const { reason } = z.object({ reason: z.string().trim().min(1) }).parse(body);
    return this.admissions.reject(idParam.parse(raw), reason, actor);
  }
}
