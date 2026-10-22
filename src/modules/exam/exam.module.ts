import { Module } from "@nestjs/common";
import { ExamService } from "./exam.service";
import { GradingService } from "./grading.service";
import { MarksService } from "./marks.service";
import { ExamController } from "./exam.controller";

/** LMS B4: grading schemes, exams and their papers, and marks entry. */
@Module({
  providers: [ExamService, GradingService, MarksService],
  controllers: [ExamController],
  exports: [MarksService, GradingService],
})
export class ExamModule {}
