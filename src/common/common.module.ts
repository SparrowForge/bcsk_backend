import { Global, Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";
import { AuditService } from "./audit.service";
import { MailService } from "./mail.service";
import { MenuCatalogService } from "./menu-catalog.service";

/** Cross-cutting services every feature module may inject. */
@Global()
@Module({
  providers: [RateLimitService, AuditService, MailService, MenuCatalogService],
  exports: [RateLimitService, AuditService, MailService, MenuCatalogService],
})
export class CommonModule {}
