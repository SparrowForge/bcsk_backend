import { Module } from "@nestjs/common";
import { ClassroomService } from "./classroom.service";
import { ClassroomController } from "./classroom.controller";
import { ScheduleModule } from "../schedule/schedule.module";
import { TeachingModule } from "../teaching/teaching.module";
import { ExamModule } from "../exam/exam.module";
import { ResultModule } from "../result/result.module";
import { ApplicationModule } from "../application/application.module";

@Module({ imports: [ScheduleModule, TeachingModule, ExamModule, ResultModule, ApplicationModule], providers: [ClassroomService], controllers: [ClassroomController], exports: [ClassroomService] })
export class ClassroomModule {}
