import { Module } from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsController } from "./analytics.controller";

/** LMS B7: the Head Master's dashboard figures. */
@Module({ providers: [AnalyticsService], controllers: [AnalyticsController] })
export class AnalyticsModule {}
