import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileService } from "../src/modules/file/file.service";
import type { PrismaService } from "../src/database/prisma.service";

/**
 * Delivery URLs for Cloudinary-backed files.
 *
 * The distinction these tests protect is easy to lose and impossible to see in a type: a
 * signed Cloudinary URL never expires, so the *only* thing giving a sensitive file a
 * lifetime is the `__cld_token__` this service attaches. A refactor that drops the token,
 * or a new folder that quietly lands on the public path, costs nothing at compile time and
 * hands out permanent links to someone's payment receipt.
 */

/** A Cloudinary-backed file: the row exists, the bytes do not (length 0 means "in the CDN"). */
const cdnBlob = (path: string) =>
  ({
    fileBlob: { findUnique: async () => ({ path, mime: "image/png", data: new Uint8Array(0) }) },
  }) as unknown as PrismaService;

const ENV = { ...process.env };

function service(path: string, tokenKey?: string) {
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "123456789";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  if (tokenKey === undefined) delete process.env.CLOUDINARY_TOKEN_KEY;
  else process.env.CLOUDINARY_TOKEN_KEY = tokenKey;
  return new FileService(cdnBlob(path));
}

// 32 hex characters — the shape Cloudinary issues, and what `Buffer.from(key, "hex")` needs.
const KEY = "00112233445566778899aabbccddeeff";

beforeEach(() => {
  process.env = { ...ENV };
});
afterEach(() => {
  process.env = { ...ENV };
});

describe("file delivery URLs", () => {
  it("gives a sensitive folder an expiring token", async () => {
    const svc = service("receipts/abc123.png", KEY);
    const out = await svc.resolve("receipts/abc123.png");

    expect(out.kind).toBe("url");
    if (out.kind !== "url") return;
    expect(out.url).toContain("__cld_token__=");
    expect(out.url).toMatch(/exp=\d+/);
    expect(out.url).toMatch(/hmac=[0-9a-f]{64}/);
  });

  it("expires that token within the configured TTL", async () => {
    process.env.CLOUDINARY_TOKEN_TTL = "60";
    const svc = service("student-docs/7/id-card.png", KEY);
    const out = await svc.resolve("student-docs/7/id-card.png");

    if (out.kind !== "url") throw new Error("expected a URL");
    const exp = Number(/exp=(\d+)/.exec(out.url)?.[1]);
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(now);
    // One second of slack: the SDK rounds its start time where this floors, so a call landing
    // on a fraction above .5 legitimately yields TTL + 1.
    expect(exp).toBeLessThanOrEqual(now + 61);
  });

  it("leaves a public folder on a stable, cacheable signed URL", async () => {
    const svc = service("gallery/photo.png", KEY);
    const first = await svc.resolve("gallery/photo.png");
    const second = await svc.resolve("gallery/photo.png");

    if (first.kind !== "url" || second.kind !== "url") throw new Error("expected URLs");
    expect(first.url).not.toContain("__cld_token__");
    expect(first.url).toMatch(/\/s--[^/]+--\//);
    // Stable across calls, which is what lets the CDN cache a public photograph at all.
    expect(first.url).toBe(second.url);
  });

  it("refuses to boot when Cloudinary is configured without a token key", () => {
    // Fail closed, and as early as possible: the permanent signed URL must never be the
    // silent consolation prize for a receipt.
    expect(() => service("receipts/abc123.png")).toThrow(/CLOUDINARY_TOKEN_KEY/);
  });

  it("boots without a token key when Cloudinary is not configured at all", async () => {
    // No CDN means no URLs to expire — every file is streamed from the database, which is
    // how local development runs, so demanding a key there would be theatre.
    process.env = { ...ENV };
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_TOKEN_KEY;

    const prisma = {
      fileBlob: {
        findUnique: async () => ({ path: "receipts/x.png", mime: "image/png", data: new Uint8Array([1]) }),
      },
    } as unknown as PrismaService;
    const out = await new FileService(prisma).resolve("receipts/x.png");

    expect(out.kind).toBe("bytes");
  });

  it("refuses to boot on a non-hex token key rather than minting tokens that 401", () => {
    expect(() => service("receipts/abc123.png", "not-hex-at-all")).toThrow(/CLOUDINARY_TOKEN_KEY/);
  });

  it("serves stored bytes without touching Cloudinary", async () => {
    process.env.CLOUDINARY_TOKEN_KEY = KEY;
    const prisma = {
      fileBlob: {
        findUnique: async () => ({ path: "receipts/old.png", mime: "image/png", data: new Uint8Array([1, 2, 3]) }),
      },
    } as unknown as PrismaService;
    // A pre-migration row still holds its bytes, so it never reaches the URL logic at all.
    const out = await new FileService(prisma).resolve("receipts/old.png");

    expect(out.kind).toBe("bytes");
  });
});
