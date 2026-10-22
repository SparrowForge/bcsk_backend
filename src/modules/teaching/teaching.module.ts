import { Module } from "@nestjs/common";
import { AttendanceReportService } from "./attendance-report.service";
import { MaterialService } from "./material.service";
import { TeachingController } from "./teaching.controller";

/** LMS B3: attendance reports and course materials. */
@Module({
  providers: [AttendanceReportService, MaterialService],
  controllers: [TeachingController],
  exports: [AttendanceReportService, MaterialService],
})
export class TeachingModule {}
