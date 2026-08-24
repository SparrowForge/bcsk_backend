import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * The one place the database is reached from.
 *
 * Carries over the pooler fix from the previous monolith: Neon's pooled endpoints run
 * PgBouncer in transaction mode, which needs Prisma's `pgbouncer=true` flag or you get
 * "prepared statement already exists". The integration-managed URL omits it, so it is
 * appended whenever the host looks pooled.
 */
function resolveDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return url;
  if (url.includes("pgbouncer=")) return url;
  const isPooled = /-pooler\./.test(url) || /pgbouncer/i.test(url);
  if (!isPooled) return url;
  return url + (url.includes("?") ? "&" : "?") + "pgbouncer=true&connect_timeout=15";
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasourceUrl: resolveDatabaseUrl() });
  }

  async onModuleInit(): Promise<void> {
    // Connect eagerly so a bad DATABASE_URL fails at boot rather than on the first request.
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
