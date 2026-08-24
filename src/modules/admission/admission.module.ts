import { Module } from "@nestjs/common";
import { AdmissionService } from "./admission.service";
import { AdmissionController } from "./admission.controller";
import { PaymentModule } from "../payment/payment.module";

@Module({
  imports: [PaymentModule],
  providers: [AdmissionService],
  controllers: [AdmissionController],
  exports: [AdmissionService],
})
export class AdmissionModule {}
