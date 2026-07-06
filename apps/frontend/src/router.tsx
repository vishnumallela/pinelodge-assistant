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
import { HomePage } from "@/routes/home";
import { StaffPage } from "@/routes/staff";
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

const indexRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: HomePage });

const staffRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/staff",
  component: StaffPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, staffRoute]),
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
