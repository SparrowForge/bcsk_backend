import { Module } from "@nestjs/common";
import { ClassroomService } from "./classroom.service";
import { ClassroomController } from "./classroom.controller";

@Module({ providers: [ClassroomService], controllers: [ClassroomController], exports: [ClassroomService] })
export class ClassroomModule {}
