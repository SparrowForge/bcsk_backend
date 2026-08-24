import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { PaymentService } from "./payment.service";
import { CurrentActor, Public, RequirePermission } from "@/common/decorators/actor.decorator";
import { requireOwnerOr } from "@/common/actor";
import type { Actor } from "@/common/actor";

const tokenQuery = z.object({ token: z.string().min(1) });
const cardOrder = z.object({ applicationId: z.coerce.number().int().positive(), token: z.string().min(1) });
const confirm = z.object({
  paymentKey: z.string().min(1),
  orderId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
});

@Controller("payments")
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  /** The amount is computed server-side from the stored record and never accepted from a client (SEC-3). */
  @Public()
  @Get("quote/:applicationId")
  quote(@Param("applicationId") id: string, @Query() query: unknown) {
    const { token } = tokenQuery.parse(query);
    return this.payments.quote(z.coerce.number().int().positive().parse(id), token);
  }

  /**
   * What the checkout UI needs to render: the publishable client key, and whether card
   * payment is available at all. The secret key never leaves the backend (SEC-2.1) — and if
   * the gateway is unconfigured the page offers bank transfer only rather than a checkout
   * that cannot complete.
   */
  @Public()
  @Get("config")
  config() {
    const { clientKey, configured } = this.payments.tossConfig();
    return { cardEnabled: configured, clientKey: configured ? clientKey : "" };
  }

  @Public()
  @Post("bank-transfer")
  bankTransfer(@Body() body: unknown) {
    const { applicationId, token, receiptPath } = z.object({
      applicationId: z.coerce.number().int().positive(),
      token: z.string().min(1),
      receiptPath: z.string().min(1),
    }).parse(body);
    return this.payments.submitBankTransfer(applicationId, token, receiptPath);
  }

  @Public()
  @Post("card-order")
  createCardOrder(@Body() body: unknown) {
    const { applicationId, token } = cardOrder.parse(body);
    return this.payments.createCardOrder(applicationId, token);
  }

  /**
   * Gateway callback. Public because Toss calls it, and idempotent because a browser
   * redirect will be replayed by refreshes, prefetches and link-preview bots (SEC-7.1).
   */
  @Public()
  @Post("toss/confirm")
  async confirmToss(@Body() body: unknown) {
    const { paymentKey, orderId, amount } = confirm.parse(body);
    const result = await this.payments.settleCardPayment(paymentKey, orderId, amount);
    if (!result.replayed) await this.payments.activateEnrolment(result.applicationId);
    return result;
  }

  @Get("mine")
  mine(@CurrentActor() actor: Actor) {
    return this.payments.listForStudent(actor.userId);
  }

  @RequirePermission("payments:read")
  @Get()
  list() {
    return this.payments.listForStaff();
  }

  /** A student may read their own payment; staff may read anyone's. */
  @Get(":id")
  async one(@Param("id") id: string, @CurrentActor() actor: Actor) {
    const paymentId = z.coerce.number().int().positive().parse(id);
    const rows = await this.payments.listForStudent(actor.userId);
    const own = rows.find((p) => p.id === paymentId);
    if (own) return own;
    requireOwnerOr(actor, -1, "payments:read");
    const all = await this.payments.listForStaff();
    return all.find((p) => p.id === paymentId) ?? null;
  }
}
