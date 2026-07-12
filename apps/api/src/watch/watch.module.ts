import { Module } from "@nestjs/common";
import { WatchController } from "./watch.controller.js";

@Module({ controllers: [WatchController] })
export class WatchModule {}
