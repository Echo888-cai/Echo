import { Module } from "@nestjs/common";
import { ResearchController } from "./research.controller.js";

@Module({ controllers: [ResearchController] })
export class ResearchModule {}
