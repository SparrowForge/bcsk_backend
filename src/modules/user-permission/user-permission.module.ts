import { Module } from "@nestjs/common";
import { UserPermissionService } from "./user-permission.service";
import { UserPermissionController } from "./user-permission.controller";

@Module({ providers: [UserPermissionService], controllers: [UserPermissionController] })
export class UserPermissionModule {}
