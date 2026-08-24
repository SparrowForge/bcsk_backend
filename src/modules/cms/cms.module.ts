import { Module } from "@nestjs/common";
import { CmsService } from "./cms.service";
import { CmsController } from "./cms.controller";

@Module({ providers: [CmsService], controllers: [CmsController], exports: [CmsService] })
export class CmsModule {}
