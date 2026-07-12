import { Module } from "@nestjs/common";
import { PortfolioController } from "./portfolio.controller.js";

@Module({ controllers: [PortfolioController] })
export class PortfolioModule {}
