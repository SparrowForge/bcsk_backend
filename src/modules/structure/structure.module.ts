import { Module } from "@nestjs/common";
import { StructureService } from "./structure.service";
import { StructureController } from "./structure.controller";
import { InstituteService } from "./institute.service";
import { InstitutesController, OwnInstituteController } from "./institute.controller";

/** LMS B1: institutes and the academic structure inside each. */
@Module({
  providers: [StructureService, InstituteService],
  controllers: [StructureController, OwnInstituteController, InstitutesController],
  exports: [StructureService],
})
export class StructureModule {}
