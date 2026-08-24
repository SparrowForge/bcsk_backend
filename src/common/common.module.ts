import { Global, Module } from "@nestjs/common";
import { RateLimitService } from "./rate-limit.service";
import { AuditService } from "./audit.service";
import { MailService } from "./mail.service";

/** Cross-cutting services every feature module may inject. */
@Global()
@Module({
  providers: [RateLimitService, AuditService, MailService],
  exports: [RateLimitService, AuditService, MailService],
})
export class CommonModule {}
