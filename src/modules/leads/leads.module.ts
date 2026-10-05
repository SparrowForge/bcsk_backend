import { Module } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { LeadSourcesService } from "./lead-sources.service";
import { LeadsController, PublicLeadsController } from "./leads.controller";

@Module({
  providers: [LeadsService, LeadSourcesService],
  controllers: [LeadsController, PublicLeadsController],
  exports: [LeadsService],
})
export class LeadsModule {}
