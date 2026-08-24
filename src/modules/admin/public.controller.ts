import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AdminService } from "./admin.service";
import { Public } from "@/common/decorators/actor.decorator";
import { RateLimitService } from "@/common/rate-limit.service";
import { verifyRecaptcha } from "@/common/recaptcha";
import { unprocessable } from "@/common/errors/app-error";

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(40).optional(),
  subject: z.string().trim().min(2).max(200),
  message: z.string().trim().min(5).max(5000),
  category: z.enum(["GENERAL", "IT", "ADMISSION"]).default("GENERAL"),
  recaptchaToken: z.string().optional(),
});

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0]!.trim();
  return req.ip ?? "unknown";
}

/**
 * Public reads that do not belong to the CMS module: curriculum, the student corner,
 * course detail, site search, and the contact form.
 */
@Controller("public")
export class PublicController {
  constructor(
    private readonly admin: AdminService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public() @Get("settings")
  settings() { return this.admin.publicSettings(); }

  @Public() @Get("special-courses")
  specialCourses() { return this.admin.specialCourses(); }

  @Public() @Get("campus-status")
  campusStatus() { return this.admin.campusStatus(); }

  @Public() @Get("hero-images")
  heroImages() { return this.admin.publicHeroImages(); }

  @Public() @Get("curriculum")
  curriculum() { return this.admin.curriculum(); }

  @Public() @Get("student-corner")
  corner() { return this.admin.publishedCornerPosts(); }

  @Public() @Get("courses/:slug")
  course(@Param("slug") slug: string) { return this.admin.courseBySlug(slug); }

  @Public() @Get("search")
  search(@Query() query: unknown) {
    const { q, lang } = z.object({ q: z.string().default(""), lang: z.string().default("en") }).parse(query);
    if (!q.trim()) return { pages: [], courses: [], news: [] };
    return this.admin.search(q.trim(), lang);
  }

  /** FR-CONT-01: the contact form creates a support ticket. */
  @Public() @Post("contact")
  async contact(@Body() body: unknown, @Req() req: Request) {
    const input = contactSchema.parse(body);
    await this.rateLimit.consume("contact", clientIp(req));
    const captcha = await verifyRecaptcha(input.recaptchaToken, "contact");
    if (!captcha.ok) throw unprocessable("Captcha verification failed. Please try again.");
    await this.admin.createTicket(input);
    return { ok: true };
  }
}
