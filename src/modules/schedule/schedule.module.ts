import { Module } from "@nestjs/common";
import { CalendarService } from "./calendar.service";
import { RoutineService } from "./routine.service";
import { OnlineClassService } from "./online-class.service";
import { CalendarController, RoutineController } from "./schedule.controller";

/** LMS B2: the academic calendar, the class routine and online classes. */
@Module({
  providers: [CalendarService, RoutineService, OnlineClassService],
  controllers: [CalendarController, RoutineController],
  exports: [RoutineService, OnlineClassService],
})
export class ScheduleModule {}
