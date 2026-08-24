import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import { PrismaService } from "@/database/prisma.service";
import { forbidden, notFound, unprocessable, misconfigured } from "@/common/errors/app-error";
import { roleHas } from "@/common/permissions";
import { log, errMessage } from "@/common/logger";
import type { Actor, MaybeActor } from "@/common/actor";

/**
 * PERF-4: uploads move to Cloudinary. Storing blobs in Postgres was a workaround for
 * Vercel's read-only filesystem; it cannot be CDN-cached and it bloats every backup.
 *
 * Reads are **dual-path** during migration: a stored path that looks like a Cloudinary
 * public id is served from Cloudinary, and anything older still comes from `FileBlob`.
 * Nothing is deleted until a backfill is verified (risk R9).
 *
 * SEC-5.1 carries over unchanged: access is **deny-by-default**. A folder with no entry in
 * POLICY is a 403, so a folder added by a future feature is inert until someone writes a
 * policy for it.
 */

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
};

type Decision = "public" | ((actor: Actor, segments: string[]) => boolean);

const isStaffReader = (a: Actor) => roleHas(a.role, "admissions:read") || roleHas(a.role, "payments:read");

function ownerOnly(allowStaff: boolean): Decision {
  return (actor, segments) => {
    if (allowStaff && (actor.role === "TEACHER" || isStaffReader(actor))) return true;
    const ownerId = Number(segments[1]);
    // A non-numeric owner segment used to yield NaN and slip past the inequality check.
    if (!Number.isInteger(ownerId)) return false;
    return ownerId === actor.userId;
  };
}

const POLICY: Record<string, Decision> = {
  gallery: "public",
  news: "public",
  governing: "public",
  "student-corner": "public",
  applications: (a) => roleHas(a.role, "admissions:read"),
  receipts: (a) => roleHas(a.role, "payments:read"),
  books: (a) => a.role === "STUDENT" || a.role === "TEACHER" || isStaffReader(a),
  assignments: (a) => a.role === "STUDENT" || a.role === "TEACHER" || isStaffReader(a),
  "class-videos": (a) => a.role === "STUDENT" || a.role === "TEACHER" || isStaffReader(a),
  submissions: ownerOnly(true),
  "student-docs": ownerOnly(true),
};

@Injectable()
export class FileService {
  private readonly configured: boolean;

  constructor(private readonly prisma: PrismaService) {
    const cloud = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const key = process.env.CLOUDINARY_API_KEY?.trim();
    const secret = process.env.CLOUDINARY_API_SECRET?.trim();
    this.configured = Boolean(cloud && key && secret);
    if (this.configured) {
      cloudinary.config({ cloud_name: cloud, api_key: key, api_secret: secret, secure: true });
    }
  }

  /** Is this actor allowed to read `path`? Deny-by-default. */
  authorise(path: string, actor: MaybeActor): void {
    const segments = path.split("/").filter((s) => s && s !== "." && s !== "..");
    if (segments.length === 0) throw notFound("File");
    const policy = POLICY[segments[0]!];
    if (policy === undefined) {
      log.warn("auth", "file_access_denied", { folder: segments[0], reason: "no_policy_for_folder" });
      throw forbidden();
    }
    if (policy === "public") return;
    if (!actor) throw forbidden();
    if (!policy(actor, segments)) {
      log.warn("auth", "file_access_denied", {
        folder: segments[0], userId: actor.userId, role: actor.role, reason: "policy_refused",
      });
      throw forbidden();
    }
  }

  /**
   * Store an upload. Validates MIME, size, and magic bytes — a declared content type is a
   * claim, not a fact.
   */
  async upload(
    file: { buffer: Buffer; mimetype: string; size: number },
    folder: string,
    maxBytes = 1024 * 1024,
  ): Promise<{ path: string }> {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw unprocessable("Only JPG, PNG, WEBP, or PDF files are accepted.");
    }
    if (file.size > maxBytes) {
      throw unprocessable(`File is too large — the limit is ${Math.round(maxBytes / 1024)} KB.`);
    }
    const b = file.buffer;
    const magicOk =
      (file.mimetype === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8) ||
      (file.mimetype === "image/png" && b[0] === 0x89 && b[1] === 0x50) ||
      (file.mimetype === "image/webp" && b.subarray(8, 12).toString() === "WEBP") ||
      (file.mimetype === "application/pdf" && b.subarray(0, 4).toString() === "%PDF");
    if (!magicOk) throw unprocessable("The file content doesn't match its type.");

    const name = randomBytes(8).toString("hex");
    const path = `${folder}/${name}.${EXT[file.mimetype]}`;

    if (this.configured) {
      try {
        const base = process.env.CLOUDINARY_FOLDER?.trim() || "bcsk";
        await new Promise<void>((resolve, reject) => {
          cloudinary.uploader
            .upload_stream(
              {
                folder: `${base}/${folder}`,
                public_id: name,
                resource_type: file.mimetype === "application/pdf" ? "raw" : "image",
                // Private delivery: reads go through a signed URL we mint after authorising.
                type: "authenticated",
              },
              (error) => (error ? reject(error) : resolve()),
            )
            .end(b);
        });
        await this.prisma.fileBlob.create({
          // Zero-byte row: the authorisation record and mime type stay in our database,
          // the bytes live in Cloudinary. The row is what POLICY is applied to.
          data: { path, mime: file.mimetype, data: new Uint8Array(0) },
        });
        return { path };
      } catch (e) {
        log.error("config", "cloudinary_upload_failed", { path, error: errMessage(e) });
        // Fall through to the database so an upload never fails on our infrastructure.
      }
    }

    await this.prisma.fileBlob.create({
      data: { path, mime: file.mimetype, data: new Uint8Array(b) },
    });
    return { path };
  }

  /**
   * Resolve a stored path to bytes or a signed URL.
   * A zero-length blob means the bytes are in Cloudinary.
   */
  async resolve(path: string): Promise<{ kind: "bytes"; mime: string; data: Buffer } | { kind: "url"; url: string }> {
    const blob = await this.prisma.fileBlob.findUnique({ where: { path } });
    if (!blob) throw notFound("File");
    if (blob.data.length > 0) {
      return { kind: "bytes", mime: blob.mime, data: Buffer.from(blob.data) };
    }
    if (!this.configured) throw misconfigured("Cloudinary is not configured but the file lives there.");

    const base = process.env.CLOUDINARY_FOLDER?.trim() || "bcsk";
    const publicId = `${base}/${path.replace(/\.[^.]+$/, "")}`;
    const url = cloudinary.url(publicId, {
      type: "authenticated",
      resource_type: blob.mime === "application/pdf" ? "raw" : "image",
      sign_url: true,
      // Short-lived: a leaked URL stops working rather than becoming a permanent hole.
      expires_at: Math.floor(Date.now() / 1000) + 300,
    } as Record<string, unknown>);
    return { kind: "url", url };
  }
}
