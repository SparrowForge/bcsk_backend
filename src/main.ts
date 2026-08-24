import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { log } from "./common/logger";
import { intFromEnv } from "./config/env";
import { apiBasePath, apiBaseUrl, apiVersion } from "./config/api";
import { readFileSync, existsSync } from "node:fs";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  /**
   * Every route lives under the configured prefix, e.g. `/api/v1`. Breaking changes ship as a
   * new API_VERSION while the old one keeps serving whatever mobile build is already in
   * people's hands — a shipped app cannot be forced to upgrade.
   */
  const basePath = apiBasePath();
  app.setGlobalPrefix(basePath);

  app.use(helmet());
  app.use(cookieParser());

  /**
   * CORS is scoped to an explicit allowlist and never `*`.
   *
   * `credentials: true` is required for the web app's httpOnly cookie, and a wildcard origin
   * with credentials is both forbidden by browsers and a genuine vulnerability. Mobile apps
   * send no Origin header and are unaffected by this list.
   */
  const origins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Client-Version"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
  });

  // The mobile team's contract. Generated from the running app, so it cannot drift.
  const swagger = new DocumentBuilder()
    .setTitle("BCSK API")
    .setDescription("Backend for the BCSK web app and mobile clients.")
    .setVersion(apiVersion())
    .addBearerAuth()
    .addCookieAuth("bcsk_session")
    .build();
  SwaggerModule.setup(`${basePath}/docs`, app, SwaggerModule.createDocument(app, swagger));

  /**
   * `intFromEnv`, not `process.env.PORT ?? 4000`: `??` does not fire on the empty string, so
   * a blank PORT would become `Number("") === 0` and bind to a random free port. That is the
   * same defect that silently broke SESSION_HOURS in production.
   */
  const port = intFromEnv("PORT", 4000);

  /**
   * dotenv never overrides a variable already present in the environment, which is correct —
   * it is how Docker and compose inject configuration. But it also means a stray PORT left in
   * a shell (from running the web app, say) silently wins over `.env`, and the API ends up on
   * the wrong port with no indication why. Surface the disagreement rather than hide it.
   */
  if (existsSync(".env")) {
    const declared = /^PORT=\s*"?(\d+)"?/m.exec(readFileSync(".env", "utf8"))?.[1];
    if (declared && Number(declared) !== port) {
      log.warn("config", "port_overridden_by_environment", {
        declaredInEnvFile: Number(declared),
        effective: port,
        hint: "A PORT variable in the environment takes precedence over .env.",
      });
    }
  }

  await app.listen(port);
  log.info("config", "backend_started", {
    port,
    prefix: apiBaseUrl(),
    corsOrigins: origins.join(",") || "(none)",
    env: process.env.NODE_ENV ?? "development",
  });
}

void bootstrap();
