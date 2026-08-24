import { Controller, Get, Query } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import { Public } from "@/common/decorators/actor.decorator";

/**
 * Liveness and readiness for the reverse proxy and uptime checks.
 *
 * Plain `/health` stays dependency-free so a database blip cannot make the proxy pull a
 * healthy process out of rotation. `?deep=1` additionally checks the database.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health(@Query("deep") deep?: string) {
    const body: Record<string, unknown> = {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
    if (deep === "1") {
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        body.database = "ok";
      } catch {
        body.database = "unreachable";
        body.status = "degraded";
      }
    }
    return body;
  }
}
