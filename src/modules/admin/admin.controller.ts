import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { AdminService } from "./admin.service";
import { CurrentActor, Public, RequirePermission } from "@/common/decorators/actor.decorator";
import type { Actor } from "@/common/actor";

const idParam = z.coerce.number().int().positive();
const reason = z.object({ reason: z.string().trim().min(1) });

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("dashboard")
  dashboard() { return this.admin.dashboard(); }

  /* --------------------------------- CMS ---------------------------------- */

  @RequirePermission("content:manage") @Get("pages")
  listPages() { return this.admin.listPages(); }

  @RequirePermission("content:manage") @Get("pages/:slug/:lang")
  getPage(@Param("slug") slug: string, @Param("lang") lang: string) {
    return this.admin.getPage(slug, lang);
  }

  @RequirePermission("content:manage") @Post("pages")
  savePage(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = z.object({
      slug: z.string(), lang: z.string(), title: z.string(),
      content: z.string(), publish: z.boolean(),
    }).parse(body);
    return this.admin.savePage(input, a);
  }

  @RequirePermission("content:manage") @Delete("pages/:slug/:lang")
  deletePage(@Param("slug") slug: string, @Param("lang") lang: string, @CurrentActor() a: Actor) {
    return this.admin.deletePage(slug, lang, a);
  }

  /* --------------------------------- news --------------------------------- */

  @RequirePermission("content:manage") @Get("news")
  listNews() { return this.admin.listNews(); }

  @RequirePermission("content:manage") @Post("news")
  saveNews(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = z.object({
      id: z.coerce.number().int().positive().optional(),
      type: z.string(), title: z.string(), body: z.string(),
      date: z.string(), published: z.boolean(),
    }).parse(body);
    return this.admin.saveNews(input, a);
  }

  @RequirePermission("content:manage") @Delete("news/:id")
  deleteNews(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.deleteNews(idParam.parse(raw), a);
  }

  /* -------------------------------- gallery -------------------------------- */

  @RequirePermission("content:manage") @Get("gallery")
  listAlbums() { return this.admin.listAlbums(); }

  @RequirePermission("content:manage") @Post("gallery/albums")
  createAlbum(@Body() body: unknown, @CurrentActor() a: Actor) {
    const { title, category } = z.object({ title: z.string(), category: z.string().nullish() }).parse(body);
    return this.admin.createAlbum(title, category ?? null, a);
  }

  @RequirePermission("content:manage") @Post("gallery/items")
  addItem(@Body() body: unknown, @CurrentActor() a: Actor) {
    const { albumId, url, caption } = z.object({
      albumId: z.coerce.number().int().positive(), url: z.string(), caption: z.string().nullish(),
    }).parse(body);
    return this.admin.addGalleryItem(albumId, url, caption ?? null, a);
  }

  @RequirePermission("content:manage") @Delete("gallery/items/:id")
  deleteItem(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.deleteGalleryItem(idParam.parse(raw), a);
  }

  @RequirePermission("content:manage") @Delete("gallery/albums/:id")
  deleteAlbum(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.deleteAlbum(idParam.parse(raw), a);
  }

  /* ----------------------------- hero slider -------------------------------- */

  @RequirePermission("content:manage") @Get("hero-images")
  listHeroImages() { return this.admin.listHeroImages(); }

  @RequirePermission("content:manage") @Post("hero-images")
  addHeroImage(@Body() body: unknown, @CurrentActor() a: Actor) {
    const { url, caption } = z.object({ url: z.string(), caption: z.string().nullish() }).parse(body);
    return this.admin.addHeroImage(url, caption ?? null, a);
  }

  @RequirePermission("content:manage") @Delete("hero-images/:id")
  deleteHeroImage(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.deleteHeroImage(idParam.parse(raw), a);
  }

  /* ---------------------------- governing body ----------------------------- */

  @RequirePermission("content:manage") @Get("governing")
  listMembers() { return this.admin.listMembers(); }

  @RequirePermission("content:manage") @Post("governing")
  saveMember(@Body() body: Record<string, unknown>, @CurrentActor() a: Actor) {
    return this.admin.saveMember(body, a);
  }

  @RequirePermission("content:manage") @Delete("governing/:id")
  deleteMember(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.deleteMember(idParam.parse(raw), a);
  }

  /* ---------------------------- student corner ----------------------------- */

  @RequirePermission("content:manage") @Get("student-corner")
  listCorner() { return this.admin.listCornerPosts(); }

  @RequirePermission("content:manage") @Post("student-corner")
  saveCorner(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = z.object({
      id: z.coerce.number().int().positive().optional(),
      title: z.string(), body: z.string(), studentName: z.string(),
      kind: z.string(), published: z.boolean(),
    }).parse(body);
    return this.admin.saveCornerPost(input, a);
  }

  @RequirePermission("content:manage") @Delete("student-corner/:id")
  deleteCorner(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.deleteCornerPost(idParam.parse(raw), a);
  }

  /* ------------------------------- courses --------------------------------- */

  @RequirePermission("courses:manage") @Get("courses")
  listCourses() { return this.admin.listCourses(); }

  @RequirePermission("courses:manage") @Patch("courses/:id")
  updateCourse(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const input = z.object({ name: z.string(), description: z.string(), active: z.boolean() }).parse(body);
    return this.admin.updateCourse(idParam.parse(raw), input, a);
  }

  @RequirePermission("courses:manage") @Patch("levels/:id")
  updateLevel(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const input = z.object({
      name: z.string(), syllabus: z.string(),
      studentBookUrl: z.string().optional(), workBookUrl: z.string().optional(),
    }).parse(body);
    return this.admin.updateLevel(idParam.parse(raw), input, a);
  }

  @RequirePermission("courses:manage") @Post("courses/:id/levels")
  addLevel(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.addLevel(idParam.parse(raw), a);
  }

  /* --------------------------------- fees ---------------------------------- */

  @RequirePermission("fees:manage") @Get("fees")
  listFees() { return this.admin.listFees(); }

  @RequirePermission("fees:manage") @Patch("fees/:id")
  updateFee(@Param("id") raw: string, @Body() body: Record<string, unknown>, @CurrentActor() a: Actor) {
    return this.admin.updateFee(idParam.parse(raw), body, a);
  }

  /* ------------------------------ scheduling ------------------------------- */

  @RequirePermission("scheduling:manage") @Get("sessions")
  listSessions() { return this.admin.listSessions(); }

  @RequirePermission("scheduling:manage") @Get("teachers")
  listTeachers() { return this.admin.listTeachers(); }

  @RequirePermission("scheduling:manage") @Patch("sessions/:id")
  updateSession(@Param("id") raw: string, @Body() body: Record<string, unknown>, @CurrentActor() a: Actor) {
    return this.admin.updateSession(idParam.parse(raw), body, a);
  }

  @RequirePermission("scheduling:manage") @Post("sessions")
  createSession(@Body() body: Record<string, unknown>, @CurrentActor() a: Actor) {
    return this.admin.createSession(body, a);
  }

  /* -------------------------------- tickets -------------------------------- */

  @RequirePermission("tickets:manage") @Get("tickets")
  listTickets() { return this.admin.listTickets(); }

  @RequirePermission("tickets:manage") @Post("tickets/:id/reply")
  replyTicket(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { reply, close } = z.object({ reply: z.string(), close: z.boolean().default(false) }).parse(body);
    return this.admin.replyTicket(idParam.parse(raw), reply, close, a);
  }

  @RequirePermission("tickets:manage") @Patch("tickets/:id/status")
  setTicketStatus(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    const { status } = z.object({ status: z.string() }).parse(body);
    return this.admin.setTicketStatus(idParam.parse(raw), status, a);
  }

  /* -------------------------------- reports -------------------------------- */

  @RequirePermission("reports:manage") @Get("students")
  listStudents() { return this.admin.listStudents(); }

  @RequirePermission("reports:manage") @Post("results")
  addResult(@Body() body: unknown, @CurrentActor() a: Actor) {
    const input = z.object({
      studentUserId: z.coerce.number().int().positive(),
      semester: z.string(), subject: z.string(),
      marks: z.coerce.number(), fullMarks: z.coerce.number().default(100),
      grade: z.string().optional(),
    }).parse(body);
    return this.admin.addExamResult(input, a);
  }

  /* --------------------------------- audit --------------------------------- */

  @RequirePermission("audit:read") @Get("audit")
  audit(@Query() query: unknown) {
    const { cursor, limit } = z.object({
      cursor: z.string().optional(), limit: z.coerce.number().int().optional(),
    }).parse(query);
    return this.admin.auditLog({ cursor, limit });
  }

  /* ------------------------------- settings -------------------------------- */

  @RequirePermission("settings:manage") @Get("settings")
  listSettings() { return this.admin.listSettings(); }

  @RequirePermission("settings:manage") @Post("settings")
  saveSettings(@Body() body: Record<string, string>, @CurrentActor() a: Actor) {
    return this.admin.saveSettings(body, a);
  }

  /* -------------------------------- payments ------------------------------- */

  @RequirePermission("payments:verify") @Post("payments/:id/verify")
  verifyPayment(@Param("id") raw: string, @CurrentActor() a: Actor) {
    return this.admin.verifyPayment(idParam.parse(raw), a);
  }

  @RequirePermission("payments:verify") @Post("payments/:id/reject")
  rejectPayment(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.admin.rejectPayment(idParam.parse(raw), reason.parse(body).reason, a);
  }

  @RequirePermission("payments:refund") @Post("payments/:id/refund")
  refundPayment(@Param("id") raw: string, @Body() body: unknown, @CurrentActor() a: Actor) {
    return this.admin.refundPayment(idParam.parse(raw), reason.parse(body).reason, a);
  }
}
