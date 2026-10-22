import { Module } from "@nestjs/common";
import { LeaveService } from "./leave.service";
import { TransferService } from "./transfer.service";
import { ApplicationController } from "./application.controller";
import { ResultModule } from "../result/result.module";

/** LMS B6: student leave and transfer applications. */
@Module({
  imports: [ResultModule],
  providers: [LeaveService, TransferService],
  controllers: [ApplicationController],
  exports: [LeaveService, TransferService],
})
export class ApplicationModule {}
