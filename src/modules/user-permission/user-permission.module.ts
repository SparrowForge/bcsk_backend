import { Module } from "@nestjs/common";
import { UserPermissionService } from "./user-permission.service";
import { UserPermissionController } from "./user-permission.controller";
import { MenuService } from "./menu.service";
import { MenuController } from "./menu.controller";

@Module({ providers: [UserPermissionService, MenuService], controllers: [UserPermissionController, MenuController] })
export class UserPermissionModule {}
