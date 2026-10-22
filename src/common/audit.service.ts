import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

/** What an audit row can carry beyond who, what and which record. */
export type AuditExtra = {
  /** The caller's address (`clientIp(req)`), where the action arrived over HTTP. */
  ip?: string | null;
  /** The fields an edit changed, as `{ before, after }`. Build it with `auditDiff`. */
  diff?: { before: Record<string, unknown>; after: Record<string, unknown> } | null;
};

/**
 * Only the fields that changed, so a row reads as the edit rather than two copies of a record.
 * Returns null when nothing changed. Never pass a secret or hash in either object.
 */
export function auditDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditExtra["diff"] {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    b[key] = before[key] ?? null;
    a[key] = after[key] ?? null;
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

/**
 * Who did what, for the school's own records — distinct from `logger`, which records what
 * the system did for operators. Every staff mutation writes one row.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    userId: number | null,
    action: string,
    entity: string,
    entityId?: string | number,
    detail?: string,
    extra?: AuditExtra,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId: entityId != null ? String(entityId) : null,
        detail,
        ip: extra?.ip ?? null,
        ...(extra?.diff ? { diff: extra.diff as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
