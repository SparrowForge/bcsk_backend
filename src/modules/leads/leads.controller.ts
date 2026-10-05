import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { LeadsService } from "./leads.service";
import { LeadSourcesService } from "./lead-sources.service";
import {
  activitySchema, activityUpdateSchema, assignSchema, bulkAssignSchema, convertSchema, createLeadSchema,
  funnelQuery, listLeadsQuery, publicEnquirySchema, sourceSchema, stageSchema, updateLeadSchema,
} from "./leads.schema";
import { CurrentActor, Public, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import type { Actor } from "../../common/actor";
import { clientIp } from "../../common/client-ip";
import { RateLimitService } from "../../common/rate-limit.service";
import { verifyRecaptcha } from "../../common/recaptcha";
import { unprocessable } from "../../common/errors/app-error";

const id = z.coerce.number().int().positive();
const mineQuery = z.object({ mine: z.enum(["1", "true"]).optional() });

/**
 * CRM. Static segments (`board`, `stats`, `follow-ups`, `activities`, `sources`, ...) are
 * declared before `:id` so they are not captured as an id.
 */
@Roles(...ADMIN_ROLES)
@Controller("leads")
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly sources: LeadSourcesService,
  ) {}

  @RequirePermission("leads:read") @Get()
  list(@Query() q: unknown) { return this.leads.list(listLeadsQuery.parse(q)); }

  @RequirePermission("leads:read") @Get("board")
  board() { return this.leads.board(); }

  @RequirePermission("leads:read") @Get("stats/funnel")
  funnel(@Query() q: unknown) { return this.leads.funnel(funnelQuery.parse(q)); }

  @RequirePermission("leads:read") @Get("follow-ups/due")
  dueFollowUps(@Query() q: unknown, @CurrentActor() actor: Actor) {
    return this.leads.dueFollowUps(mineQuery.parse(q).mine ? actor.userId : undefined);
  }

  @RequirePermission("leads:read") @Get("activities/due")
  dueActivities(@Query() q: unknown, @CurrentActor() actor: Actor) {
    return this.leads.dueActivities(mineQuery.parse(q).mine ? actor.userId : undefined);
  }

  @RequirePermission("leads:read") @Get("assignees")
  assignees() { return this.leads.assignees(); }

  @RequirePermission("leads:read") @Get("courses")
  courses() { return this.leads.courseOptions(); }

  @RequirePermission("leads:read") @Get("duplicates/check")
  duplicates(@Query() q: unknown) {
    const { email, phone } = z.object({ email: z.string().optional(), phone: z.string().optional() }).parse(q);
    return this.leads.findDuplicate(email, phone);
  }

  /* sources */
  @RequirePermission("leads:read") @Get("sources")
  listSources() { return this.sources.list(); }

  @RequirePermission("leads:manage") @Post("sources")
  createSource(@Body() b: unknown) { return this.sources.create(sourceSchema.parse(b)); }

  @RequirePermission("leads:manage") @Patch("sources/:id")
  updateSource(@Param("id") raw: string, @Body() b: unknown) {
    return this.sources.update(id.parse(raw), sourceSchema.partial().parse(b));
  }

  @RequirePermission("leads:manage") @Delete("sources/:id")
  removeSource(@Param("id") raw: string) { return this.sources.remove(id.parse(raw)); }

  /* activities (by activity id) */
  @RequirePermission("leads:manage") @Patch("activities/:activityId")
  updateActivity(@Param("activityId") raw: string, @Body() b: unknown) {
    return this.leads.updateActivity(id.parse(raw), activityUpdateSchema.parse(b));
  }

  @RequirePermission("leads:manage") @Delete("activities/:activityId")
  removeActivity(@Param("activityId") raw: string) { return this.leads.removeActivity(id.parse(raw)); }

  @RequirePermission("leads:manage") @Patch("assign/bulk")
  bulkAssign(@Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.leads.bulkAssign(bulkAssignSchema.parse(b), actor);
  }

  @RequirePermission("leads:manage") @Post()
  create(@Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.leads.create(createLeadSchema.parse(b), actor);
  }

  /* one lead */
  @RequirePermission("leads:read") @Get(":id")
  one(@Param("id") raw: string) { return this.leads.one(id.parse(raw)); }

  @RequirePermission("leads:manage") @Patch(":id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.leads.update(id.parse(raw), updateLeadSchema.parse(b), actor);
  }

  @RequirePermission("leads:manage") @Delete(":id")
  remove(@Param("id") raw: string, @CurrentActor() actor: Actor) { return this.leads.remove(id.parse(raw), actor); }

  @RequirePermission("leads:manage") @Patch(":id/restore")
  restore(@Param("id") raw: string, @CurrentActor() actor: Actor) { return this.leads.restore(id.parse(raw), actor); }

  @RequirePermission("leads:manage") @Patch(":id/stage")
  stage(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.leads.setStage(id.parse(raw), stageSchema.parse(b), actor);
  }

  @RequirePermission("leads:manage") @Patch(":id/assign")
  assign(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.leads.assign(id.parse(raw), assignSchema.parse(b), actor);
  }

  @RequirePermission("leads:manage") @Post(":id/convert")
  convert(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.leads.convert(id.parse(raw), convertSchema.parse(b ?? {}), actor);
  }

  @RequirePermission("leads:read") @Get(":id/activities")
  activities(@Param("id") raw: string) { return this.leads.activities(id.parse(raw)); }

  @RequirePermission("leads:manage") @Post(":id/activities")
  logActivity(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() actor: Actor) {
    return this.leads.logActivity(id.parse(raw), activitySchema.parse(b), actor);
  }
}

/**
 * Web-to-lead. Deliberately unauthenticated, and correspondingly narrow: the payload cannot
 * set stage, owner or a non-public source, and the answer is identical whether or not the
 * contact was already on file.
 */
@Controller("public/leads")
export class PublicLeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly sources: LeadSourcesService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public() @Post("enquiry")
  async enquiry(@Body() body: unknown, @Req() req: Request) {
    const input = publicEnquirySchema.parse(body);
    await this.rateLimit.consume("lead", clientIp(req));
    const captcha = await verifyRecaptcha(input.recaptchaToken, "lead");
    if (!captcha.ok) throw unprocessable("Captcha verification failed. Please try again.");
    await this.leads.createFromPublicForm(input);
    return { ok: true };
  }

  @Public() @Get("sources")
  publicSources() { return this.sources.publicList(); }
}
