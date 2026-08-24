import {
  Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import type { Request, Response } from "express";
import { FileService } from "./file.service";
import { Public } from "@/common/decorators/actor.decorator";
import { RateLimitService } from "@/common/rate-limit.service";
import { unprocessable, forbidden } from "@/common/errors/app-error";
import type { Actor } from "@/common/actor";

/**
 * SEC-5.1: deny-by-default file delivery.
 *
 * Marked @Public() because the *policy table*, not the guard, decides access — some folders
 * are genuinely public and the rest are authorised per-folder inside the service against the
 * actor the guard already resolved.
 */
@Controller("files")
export class FileController {
  constructor(
    private readonly files: FileService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Upload a file and receive the stored path.
   *
   * Public because an applicant is anonymous when they attach their photo — but the folder
   * is an allowlist, not a caller-chosen string, so nobody can write into `books/` or invent
   * a folder that the read policy has no entry for. Size and magic bytes are checked in the
   * service; this only decides *where* a stranger may write.
   */
  @Public()
  @Post()
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: unknown,
    @Req() req: Request & { actor?: Actor },
  ) {
    if (!file) throw unprocessable("No file was received.");

    const { folder } = z
      .object({ folder: z.enum(["applications", "receipts", "submissions", "assignments", "gallery", "books"]) })
      .parse(body);

    // Anonymous callers may only attach to their own application or payment.
    const anonymousFolders = ["applications", "receipts"];
    if (!req.actor && !anonymousFolders.includes(folder)) throw forbidden();

    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? "unknown";
    await this.rateLimit.consume("apply", ip);

    const limits: Record<string, number> = {
      applications: 1024 * 1024,
      receipts: 5 * 1024 * 1024,
      submissions: 5 * 1024 * 1024,
      assignments: 10 * 1024 * 1024,
      gallery: 8 * 1024 * 1024,
      books: 30 * 1024 * 1024,
    };
    return this.files.upload(
      { buffer: file.buffer, mimetype: file.mimetype, size: file.size },
      folder,
      limits[folder],
    );
  }

  @Public()
  @Get("*path")
  async serve(@Param("path") path: string | string[], @Req() req: Request & { actor?: Actor }, @Res() res: Response) {
    const rel = Array.isArray(path) ? path.join("/") : path;
    this.files.authorise(rel, req.actor ?? null);
    const resolved = await this.files.resolve(rel);

    if (resolved.kind === "url") {
      // Redirect rather than proxy: the CDN serves the bytes, we only decide who may.
      return res.redirect(302, resolved.url);
    }
    res.setHeader("Content-Type", resolved.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.send(resolved.data);
  }
}
