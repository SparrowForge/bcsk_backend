import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { map, type Observable } from "rxjs";

/**
 * Wraps every successful response as `{ data }` — plus `{ meta }` for paginated results.
 *
 * A bare value leaves no room to add pagination or a correlation id later without breaking
 * clients, and a shipped mobile app is the hardest client to migrate.
 *
 * A controller returning a `Page` (items + nextCursor) is unwrapped into data + meta, so
 * pagination shape is decided once rather than per endpoint.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { requestId?: string }>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId ?? crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    return next.handle().pipe(
      map((payload: unknown) => {
        if (payload === undefined || payload === null) return { data: null };
        // Streams and files bypass the envelope — they are not JSON.
        if (Buffer.isBuffer(payload)) return payload;
        if (
          typeof payload === "object" &&
          "items" in (payload as object) &&
          "nextCursor" in (payload as object)
        ) {
          const page = payload as { items: unknown[]; nextCursor: string | null };
          return { data: page.items, meta: { nextCursor: page.nextCursor } };
        }
        return { data: payload };
      }),
    );
  }
}
