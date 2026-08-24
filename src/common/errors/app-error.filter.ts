import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, ERROR_CODES, httpStatusFor, isAppError, type ErrorDetails } from "./app-error";
import { log, errMessage } from "@/common/logger";

/**
 * The single place a thrown value becomes an HTTP response.
 *
 * Services throw `AppError` with a stable code; this maps it. Nothing else in the codebase
 * decides a status code, so a rule behaves identically no matter which controller reached it.
 *
 * 5xx messages describe our internals and are replaced with a generic string — the caller
 * gets a correlation id instead, which is what support actually needs.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? crypto.randomUUID();
    const route = req.originalUrl;

    const send = (
      status: number,
      code: string,
      message: string,
      details?: ErrorDetails,
      retryAfterSeconds?: number,
    ) => {
      if (retryAfterSeconds != null) res.setHeader("retry-after", String(retryAfterSeconds));
      res.setHeader("x-request-id", requestId);
      res.status(status).json({ error: { code, message, details, requestId } });
    };

    if (exception instanceof ZodError) {
      const details: ErrorDetails = {};
      for (const i of exception.issues) details[i.path.join(".") || "_"] = i.message;
      return send(400, ERROR_CODES.VALIDATION_FAILED, "Please check the highlighted fields.", details);
    }

    if (isAppError(exception)) {
      const status = httpStatusFor(exception.code);
      log[exception.expose ? "warn" : "error"]("auth", "api_error", {
        requestId, route, code: exception.code, message: exception.message,
      });
      return send(
        status,
        exception.code,
        exception.expose ? exception.message : "Something went wrong on our side. Please try again.",
        exception.details,
        exception.retryAfterSeconds,
      );
    }

    // Prisma's unique-constraint violation is a conflict, not a server error. This is what
    // makes a duplicated payment capture (SEC-7.1) read correctly to the caller.
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === "P2002") {
      return send(409, ERROR_CODES.CONFLICT, "That record already exists.");
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === HttpStatus.NOT_FOUND ? ERROR_CODES.NOT_FOUND : ERROR_CODES.INTERNAL;
      return send(status, code, status < 500 ? exception.message : "Something went wrong on our side.");
    }

    log.error("auth", "api_unhandled", { requestId, route, error: errMessage(exception) });
    send(500, ERROR_CODES.INTERNAL, "Something went wrong on our side. Please try again.");
  }
}
