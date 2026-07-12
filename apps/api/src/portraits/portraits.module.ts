import { Module } from "@nestjs/common";
import { PortraitsController } from "./portraits.controller.js";

@Module({ controllers: [PortraitsController] })
export class PortraitsModule {}
