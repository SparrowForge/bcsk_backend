import { Module } from "@nestjs/common";
import { ResultService } from "./result.service";
import { ReportService } from "./report.service";
import { ResultController } from "./result.controller";

/** LMS B5: result processing, approval and publishing; reports; certificates. */
@Module({
  providers: [ResultService, ReportService],
  controllers: [ResultController],
  exports: [ResultService, ReportService],
})
export class ResultModule {}
