import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileService } from "../src/modules/file/file.service";
import type { PrismaService } from "../src/database/prisma.service";

/**
 * Delivery URLs for Cloudinary-backed files.
 *
 * These pin the two things that are easy to break by accident and invisible in a type: that
 * a migrated file resolves to a *signed* URL rather than a bare public one, and that a
 * pre-migration row still serves its own bytes without going near the CDN.
 *
 * What they deliberately do not claim is that the URL expires. It does not — see the note on
 * `resolve()`. Expiry would need token authentication, which the account's plan does not
 * offer; if that changes, these tests are where the new shape should be asserted.
 */

/** A Cloudinary-backed file: the row exists, the bytes do not (length 0 means "in the CDN"). */
const cdnBlob = (path: string) =>
  ({
    fileBlob: { findUnique: async () => ({ path, mime: "image/png", data: new Uint8Array(0) }) },
  }) as unknown as PrismaService;

const ENV = { ...process.env };

function service(path: string) {
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "123456789";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  return new FileService(cdnBlob(path));
}

beforeEach(() => {
  process.env = { ...ENV };
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("file delivery URLs", () => {
  it("signs the delivery URL for a migrated file", async () => {
    const out = await service("receipts/abc123.png").resolve("receipts/abc123.png");

    expect(out.kind).toBe("url");
    if (out.kind !== "url") return;
    // `s--…--` is the signature segment; without it the asset would be openly addressable.
    expect(out.url).toMatch(/\/s--[^/]+--\//);
    expect(out.url).toContain("/authenticated/");
  });

  it("keeps the URL stable, which is what lets the CDN cache it", async () => {
    const svc = service("gallery/photo.png");
    const first = await svc.resolve("gallery/photo.png");
    const second = await svc.resolve("gallery/photo.png");

    if (first.kind !== "url" || second.kind !== "url") throw new Error("expected URLs");
    expect(first.url).toBe(second.url);
  });

  it("serves a pre-migration row from its own bytes, without touching Cloudinary", async () => {
    const prisma = {
      fileBlob: {
        findUnique: async () => ({ path: "receipts/old.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) }),
      },
    } as unknown as PrismaService;
    const out = await new FileService(prisma).resolve("receipts/old.png");

    expect(out.kind).toBe("bytes");
  });

  it("refuses a CDN-backed file when Cloudinary is not configured, rather than inventing a URL", async () => {
    process.env = { ...ENV };
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;

    const svc = new FileService(cdnBlob("receipts/abc123.png"));
    await expect(svc.resolve("receipts/abc123.png")).rejects.toThrow(/not configured/i);
  });
});
