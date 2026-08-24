import { Module } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminController } from "./admin.controller";
import { PublicController } from "./public.controller";
import { PaymentModule } from "@/modules/payment/payment.module";

@Module({
  imports: [PaymentModule],
  providers: [AdminService],
  controllers: [AdminController, PublicController],
  exports: [AdminService],
})
export class AdminModule {}
