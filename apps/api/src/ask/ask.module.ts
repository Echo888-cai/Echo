import { Module } from "@nestjs/common";
import { AskController } from "./ask.controller.js";

@Module({ controllers: [AskController] })
export class AskModule {}
