import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet
} from "@tanstack/react-router";
import { LoginPage } from "./routes/login";
import { SettingsPage } from "./routes/settings";
import { PortfolioPage } from "./routes/portfolio";
import { WatchListPage, StockDetailPage } from "./routes/watch";
import { ResearchPage } from "./routes/research";

const rootRoute = createRootRoute({
  component: () => <Outlet />
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ResearchPage
});

// Legacy's landing page "/" and "/research" are the same view (nav tab
// highlights both); kept as a real alias route rather than a redirect so
// direct links to /research still work.
const researchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/research",
  component: ResearchPage
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage
});

const watchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watch",
  component: WatchListPage
});

// Per-ticker stock detail (watch.js's #/watch/:ticker).
const watchTickerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watch/$ticker",
  component: () => {
    const { ticker } = watchTickerRoute.useParams();
    return <StockDetailPage ticker={ticker} />;
  }
});

const portfolioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/portfolio",
  component: PortfolioPage
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  researchRoute,
  loginRoute,
  watchRoute,
  watchTickerRoute,
  portfolioRoute,
  settingsRoute
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
