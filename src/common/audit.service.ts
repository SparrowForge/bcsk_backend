import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";

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
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { userId, action, entity, entityId: entityId != null ? String(entityId) : null, detail },
    });
  }
}
