import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";
import { clientIp } from "./client-ip";

/**
 * The global request ceiling, keyed on the visitor rather than on whoever relayed the request.
 * The stock guard keys on `req.ip`, which for server-rendered pages is the web server — so the
 * whole site shared one 120-requests-a-minute allowance. See `client-ip.ts`.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return clientIp(req as unknown as Request);
  }
}
