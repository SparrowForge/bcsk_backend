import { Global, Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { RefreshTokenService } from "./refresh-token.service";
import { AuthController } from "./auth.controller";

/** Global: the AuthGuard needs AuthService on every route. */
@Global()
@Module({
  providers: [AuthService, RefreshTokenService],
  controllers: [AuthController],
  exports: [AuthService, RefreshTokenService],
})
export class AuthModule {}
