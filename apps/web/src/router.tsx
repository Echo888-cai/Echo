import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet
} from "@tanstack/react-router";
import { LoginPage } from "./routes/login";
import { PlaceholderPage } from "./routes/placeholder";
import { SettingsPage } from "./routes/settings";
import { PortfolioPage } from "./routes/portfolio";

const rootRoute = createRootRoute({
  component: () => <Outlet />
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <PlaceholderPage label="研究" />
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage
});

const watchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watch",
  component: () => <PlaceholderPage label="看盘" />
});

// Per-ticker stock detail (watch.js's #/watch/:ticker) — still a stub until
// the watch-page slice lands; wired up now so portfolio cards have somewhere
// real to link to instead of a dead route.
const watchTickerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/watch/$ticker",
  component: () => <PlaceholderPage label="个股" />
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
