import { Module } from "@nestjs/common";
import { HkFinancialsController } from "./hkFinancials.controller.js";

@Module({ controllers: [HkFinancialsController] })
export class HkFinancialsModule {}
