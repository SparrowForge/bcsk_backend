import { Module } from "@nestjs/common";
import { OfficeService } from "./office.service";
import { OfficeController } from "./office.controller";
import { ScheduleModule } from "../schedule/schedule.module";
import { TeachingModule } from "../teaching/teaching.module";
import { ExamModule } from "../exam/exam.module";
import { ResultModule } from "../result/result.module";
import { ApplicationModule } from "../application/application.module";

@Module({ imports: [ScheduleModule, TeachingModule, ExamModule, ResultModule, ApplicationModule], providers: [OfficeService], controllers: [OfficeController], exports: [OfficeService] })
export class OfficeModule {}
