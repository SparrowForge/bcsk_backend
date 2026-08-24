import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./database/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AuthGuard } from "./common/guards/auth.guard";
import { AppErrorFilter } from "./common/errors/app-error.filter";
import { EnvelopeInterceptor } from "./common/interceptors/envelope.interceptor";
import { CmsModule } from "./modules/cms/cms.module";
import { HealthModule } from "./modules/health/health.module";
import { CommonModule } from "./common/common.module";
import { FileModule } from "./modules/file/file.module";
import { UserModule } from "./modules/user/user.module";
import { PaymentModule } from "./modules/payment/payment.module";
import { AdmissionModule } from "./modules/admission/admission.module";
import { ClassroomModule } from "./modules/classroom/classroom.module";
import { OfficeModule } from "./modules/office/office.module";
import { DocumentModule } from "./modules/document/document.module";
import { AdminModule } from "./modules/admin/admin.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Next expands ${VAR} in .env via dotenv-expand; Nest does not unless asked. Enabling
      // it keeps one .env syntax across both projects instead of two subtly different ones.
      expandVariables: true,
    }),
    // SEC-8: a coarse global ceiling. Per-endpoint limits (login, apply, contact) are
    // stricter and stay database-backed so they survive across instances.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    CommonModule,
    AuthModule,
    CmsModule,
    FileModule,
    UserModule,
    PaymentModule,
    AdmissionModule,
    ClassroomModule,
    OfficeModule,
    DocumentModule,
    AdminModule,
    HealthModule,
  ],
  providers: [
    // Order matters: throttling rejects before any authentication work is done.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global by design — every route is authenticated unless marked @Public() (risk R10).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AppErrorFilter },
  ],
})
export class AppModule {}
