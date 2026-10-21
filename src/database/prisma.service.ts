import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/**
 * The one place the database is reached from.
 *
 * Deliberately does NOT append Prisma's `pgbouncer=true`. Neon's pooler tracks prepared
 * statements itself (PgBouncer `max_prepared_statements`), so the old "prepared statement
 * already exists" failure no longer happens, while the flag turned off statement caching and
 * cost ~5 round trips per query instead of 1 (measured 21 Oct 2026: ~260ms vs ~50ms at a
 * 52ms RTT; 400 concurrent pooled queries without it, zero errors). Pooled hosts still get a
 * longer connect timeout, since a suspended Neon compute takes a moment to wake.
 */
function resolveDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return url;
  if (url.includes("connect_timeout=")) return url;
  const isPooled = /-pooler\./.test(url) || /pgbouncer/i.test(url);
  if (!isPooled) return url;
  return url + (url.includes("?") ? "&" : "?") + "connect_timeout=15";
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
