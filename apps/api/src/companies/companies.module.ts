import { Module } from "@nestjs/common";
import { CompaniesController } from "./companies.controller.js";

@Module({ controllers: [CompaniesController] })
export class CompaniesModule {}
