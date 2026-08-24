import { Module } from "@nestjs/common";
import { OfficeService } from "./office.service";
import { OfficeController } from "./office.controller";

@Module({ providers: [OfficeService], controllers: [OfficeController], exports: [OfficeService] })
export class OfficeModule {}
