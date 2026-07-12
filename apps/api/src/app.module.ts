import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";

import { AuthModule } from "./auth/auth.module.js";
import { CompaniesModule } from "./companies/companies.module.js";
import { PortfolioModule } from "./portfolio/portfolio.module.js";
import { AskModule } from "./ask/ask.module.js";
import { ChatModule } from "./chat/chat.module.js";
import { DiscoverModule } from "./discover/discover.module.js";
import { DocumentsModule } from "./documents/documents.module.js";
import { EventsModule } from "./events/events.module.js";
import { HkFinancialsModule } from "./hkFinancials/hkFinancials.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { PortraitsModule } from "./portraits/portraits.module.js";
import { PreferencesModule } from "./preferences/preferences.module.js";
import { ReportsModule } from "./reports/reports.module.js";
import { ResearchModule } from "./research/research.module.js";
import { StatusModule } from "./status/status.module.js";
import { WatchModule } from "./watch/watch.module.js";

import { RateLimitMiddleware } from "./common/rate-limit.middleware.js";
import { CsrfMiddleware } from "./common/csrf.middleware.js";
import { AuthGuard } from "./common/auth.guard.js";
import { EnvelopeExceptionFilter } from "./common/exception.filter.js";

@Module({
  imports: [
    AuthModule,
    CompaniesModule,
    PortfolioModule,
    AskModule,
    ChatModule,
    DiscoverModule,
    DocumentsModule,
    EventsModule,
    HkFinancialsModule,
    NotificationsModule,
    PortraitsModule,
    PreferencesModule,
    ReportsModule,
    ResearchModule,
    StatusModule,
    WatchModule
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: EnvelopeExceptionFilter }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Mirrors server.js: every /api/* request is rate-limited then CSRF-checked
    // before auth resolution (AuthGuard, registered as APP_GUARD, runs after
    // middleware in Nest's request lifecycle — same order as today).
    consumer.apply(RateLimitMiddleware, CsrfMiddleware).forRoutes("/api*");
  }
}
