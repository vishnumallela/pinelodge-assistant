import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { sessionQuery } from "@/lib/session";
import { AppLayout } from "@/components/layout/AppLayout";
import { NotFound, RouteError } from "@/components/layout/RouteFallbacks";
import { LedgerPage } from "@/routes/ledger";
import { CallPage } from "@/routes/call";
import { StaffPage } from "@/routes/staff";
import { CentersPage } from "@/routes/centers";
import { PhonePage } from "@/routes/phone";
import { SettingsPage } from "@/routes/settings";
import { LoginPage } from "@/routes/login";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({ component: () => <Outlet /> });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session?.user) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session?.user) throw redirect({ to: "/login" });
  },
  component: AppLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: LedgerPage,
});

const callRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/calls/$callId",
  component: CallPage,
});

const staffRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/staff",
  component: StaffPage,
});

const centersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/centers",
  component: CentersPage,
});

const phoneRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/phone",
  component: PhonePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    callRoute,
    staffRoute,
    centersRoute,
    phoneRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: RouteError,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
