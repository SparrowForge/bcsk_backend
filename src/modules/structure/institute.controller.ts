import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { InstituteService } from "./institute.service";
import { instituteProfileSchema, instituteSchema } from "./structure.schema";
import { CurrentActor, RequirePermission, Roles } from "../../common/decorators/actor.decorator";
import { ADMIN_ROLES } from "../../common/constants";
import { clientIp } from "../../common/client-ip";
import type { Actor } from "../../common/actor";

const id = z.coerce.number().int().positive();

/** The caller's own institute profile. */
@Roles(...ADMIN_ROLES)
@Controller("institute")
export class OwnInstituteController {
  constructor(private readonly institutes: InstituteService) {}

  @RequirePermission("institute:manage") @Get()
  own(@CurrentActor() a: Actor) { return this.institutes.own(a); }

  @RequirePermission("institute:manage") @Patch()
  updateOwn(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.institutes.updateOwn(a, instituteProfileSchema.parse(b), clientIp(r));
  }
}

/**
 * Every institute on the platform. Super admin only: no capability grants it, so it cannot be
 * handed out on the menu grid.
 */
@Roles("SUPER_ADMIN")
@Controller("institutes")
export class InstitutesController {
  constructor(private readonly institutes: InstituteService) {}

  @Get()
  list() { return this.institutes.list(); }

  @Post()
  create(@Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.institutes.create(a, instituteSchema.parse(b), clientIp(r));
  }

  @Patch(":id")
  update(@Param("id") raw: string, @Body() b: unknown, @CurrentActor() a: Actor, @Req() r: Request) {
    return this.institutes.update(a, id.parse(raw), instituteSchema.parse(b), clientIp(r));
  }
}
