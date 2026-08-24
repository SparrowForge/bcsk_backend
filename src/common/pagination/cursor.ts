import { validationFailed } from "@/common/errors/app-error";

/**
 * Cursor pagination for list endpoints.
 *
 * Cursor rather than offset because these lists grow and are read while being written —
 * the audit log and the payment ledger most of all. Offset pagination silently skips or
 * repeats rows when something is inserted between two page requests; a cursor anchored to
 * an id does not.
 *
 * The cursor is an opaque base64 string by intent: callers must not construct or decode it,
 * so its encoding stays ours to change.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type PageRequest = { cursor?: string | null; limit?: number | null };

export type Page<T> = {
  items: T[];
  /** Pass back as `cursor` to fetch the next page. `null` means this was the last page. */
  nextCursor: string | null;
};

export function encodeCursor(id: number): string {
  return Buffer.from(String(id), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): number {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw validationFailed({ cursor: "Invalid pagination cursor." }, "Invalid pagination cursor.");
  }
  return id;
}

export function resolveLimit(limit?: number | null): number {
  if (limit == null || !Number.isFinite(limit)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
}

/**
 * Build the Prisma arguments for one page. Requests `limit + 1` rows so the caller can
 * tell whether another page exists without a second count query.
 */
export function toPrismaPage(req: PageRequest): { take: number; skip?: number; cursor?: { id: number } } {
  const take = resolveLimit(req.limit) + 1;
  if (!req.cursor) return { take };
  // skip:1 steps past the cursor row itself, which Prisma otherwise includes.
  return { take, skip: 1, cursor: { id: decodeCursor(req.cursor) } };
}

/** Trim the extra row fetched by `toPrismaPage` and derive the next cursor. */
export function toPage<T extends { id: number }>(rows: T[], req: PageRequest): Page<T> {
  const limit = resolveLimit(req.limit);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor: hasMore ? encodeCursor(items[items.length - 1]!.id) : null,
  };
}
