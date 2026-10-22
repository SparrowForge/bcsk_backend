import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { CalendarService } from "./calendar.service";
import { RoutineService } from "./routine.service";
import { eventSchema, rangeSchema, routineFilter, slotSchema, slotUpdateSchema } from "./schedule.schema";
import { CurrentActor, Public, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import { clientIp } from "../../common/client-ip";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();

/**
 * The academic calendar. Reading is for everyone signed in - each sees what is meant for them -
 * and the public site reads the school's open entries. Writing is the Head Master's.
 */
@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Public() @Get("public")
  publicFeed(@Query() q: unknown) { return this.calendar.publicFeed(rangeSchema.parse(q)); }

  @Get()
  feed(@Query() q: unknown, @CurrentActor() a: Actor) { return this.calendar.feed(a, rangeSchema.parse(q)); }

  @Roles(...ADMIN_ROLES) @RequirePermission("calendar:manage") @Get("events")
  manage(@Query() q: unknown, @CurrentActor() a: Actor) { return this.calendar.manage(a, rangeSchema.parse(q)); }

  @Roles(...ADMIN_ROLES) @RequirePermission("calendar:manage") @Post("events")
  create(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.calendar.create(a, eventSchema.parse(b), clientIp(r));
  }

  @Roles(...ADMIN_ROLES) @RequirePermission("calendar:manage") @Patch("events/:id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.calendar.update(a, id.parse(raw), eventSchema.parse(b), clientIp(r));
  }

  @Roles(...ADMIN_ROLES) @RequirePermission("calendar:manage") @Delete("events/:id")
  remove(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.calendar.remove(a, id.parse(raw), clientIp(r));
  }
}

/** The routine builder and online-class monitor of the admin panel. */
@Roles(...ADMIN_ROLES)
@Controller("routine")
export class RoutineController {
  constructor(private readonly routine: RoutineService) {}

  @RequirePermission("scheduling:manage") @Get("slots")
  slots(@Query() q: unknown, @CurrentActor() a: Actor) { return this.routine.slots(a, routineFilter.parse(q)); }

  @RequirePermission("scheduling:manage") @Post("slots")
  create(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.routine.createSlot(a, slotSchema.parse(b), clientIp(r));
  }

  @RequirePermission("scheduling:manage") @Patch("slots/:id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.routine.updateSlot(a, id.parse(raw), slotUpdateSchema.parse(b), clientIp(r));
  }

  @RequirePermission("scheduling:manage") @Delete("slots/:id")
  remove(@Param("id") raw: string, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.routine.removeSlot(a, id.parse(raw), clientIp(r));
  }

  @RequirePermission("scheduling:manage") @Get("online-classes")
  onlineClasses(@Query() q: unknown, @CurrentActor() a: Actor) { return this.routine.onlineClasses(a, rangeSchema.parse(q)); }
}
