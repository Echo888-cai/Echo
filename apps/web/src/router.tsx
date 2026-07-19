import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouterState
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { Shell } from "./components/Shell";

const LoginPage = lazy(() => import("./routes/login").then((module) => ({ default: module.LoginPage })));
const SettingsPage = lazy(() => import("./routes/settings").then((module) => ({ default: module.SettingsPage })));
const PortfolioPage = lazy(() => import("./routes/portfolio").then((module) => ({ default: module.PortfolioPage })));
const WatchListPage = lazy(() => import("./routes/watch").then((module) => ({ default: module.WatchListPage })));
const StockDetailPage = lazy(() => import("./routes/watch").then((module) => ({ default: module.StockDetailPage })));
const ResearchPage = lazy(() => import("./routes/research").then((module) => ({ default: module.ResearchPage })));
const MembershipPage = lazy(() => import("./routes/membership").then((module) => ({ default: module.MembershipPage })));

function RouteFrame() {
  return (
    <Suspense
      fallback={
        <div className="route-loading" role="status" aria-live="polite">
          <span />
          <p>ECHO / LOADING</p>
        </div>
      }
    >
      <Outlet />
    </Suspense>
  );
}

function PageFallback() {
  return <div className="page-route-fallback" aria-hidden="true" />;
}

function PageStage() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="page-stage" key={pathname}>
      <Outlet />
    </div>
  );
}

/** Keep Shell mounted across tab switches so the topbar never remounts / flashes. */
function AuthenticatedLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sidebar = pathname === "/" || pathname === "/research";
  return (
    <Shell sidebar={sidebar}>
      <Suspense fallback={<PageFallback />}>
        <PageStage />
      </Suspense>
    </Shell>
  );
}

const rootRoute = createRootRoute({
  component: RouteFrame
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  component: AuthenticatedLayout
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: ResearchPage
});

// Landing page and /research are aliases; a real route keeps
// direct links to /research still work.
const researchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/research",
  component: ResearchPage
});

const watchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/watch",
  component: WatchListPage
});

// Per-ticker stock detail (watch.js's #/watch/:ticker).
const watchTickerRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/watch/$ticker",
  component: () => {
    const { ticker } = watchTickerRoute.useParams();
    return <StockDetailPage ticker={ticker} />;
  }
});

const portfolioRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/portfolio",
  component: PortfolioPage
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage
});

const membershipRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/membership",
  component: MembershipPage
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    researchRoute,
    watchRoute,
    watchTickerRoute,
    portfolioRoute,
    settingsRoute,
    membershipRoute
  ])
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
