import { Controller, Get, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { CmsService } from "./cms.service";
import { Public } from "@/common/decorators/actor.decorator";

const langSchema = z.enum(["en", "bn", "ko"]).default("en");
const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().optional(),
  /** Optional filter: NEWS | SEMINAR | EVENT. */
  type: z.string().optional(),
});

/**
 * Public content. Every route is explicitly `@Public()` — the global guard requires
 * authentication by default, so opening a route is always a deliberate act (risk R10).
 */
@Controller("cms")
export class CmsController {
  constructor(private readonly cms: CmsService) {}

  @Public()
  @Get("pages/:slug")
  getPage(@Param("slug") slug: string, @Query("lang") lang?: string) {
    return this.cms.getPage(slug, langSchema.parse(lang ?? "en"));
  }

  @Public()
  @Get("news")
  listNews(@Query() query: unknown) {
    const { cursor, limit, type } = pageQuery.parse(query);
    return this.cms.listNews({ cursor, limit }, type);
  }

  @Public()
  @Get("news/:id")
  getNewsItem(@Param("id") id: string) {
    return this.cms.getNewsItem(z.coerce.number().int().positive().parse(id));
  }

  @Public()
  @Get("teachers")
  teachers() {
    return this.cms.listPublicTeachers();
  }

  @Public()
  @Get("governing-body")
  governing() {
    return this.cms.listGoverningMembers("GOVERNING");
  }

  @Public()
  @Get("regional-representatives")
  regional() {
    return this.cms.listGoverningMembers("REGIONAL");
  }

  @Public()
  @Get("fees")
  fees() {
    return this.cms.listFees();
  }

  @Public()
  @Get("gallery")
  gallery() {
    return this.cms.listGalleryAlbums();
  }
}
