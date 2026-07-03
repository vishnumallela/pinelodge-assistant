import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@pinelodge/api-contracts";
import { env } from "./env";
import { bearerToken } from "./bearer";

const link = new RPCLink({
  url: `${env.API_URL}/orpc`,
  fetch: (request, init) => {
    const headers = new Headers(request.headers);
    const token = bearerToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(request, { ...init, credentials: "include", headers });
  },
});

export const orpcClient: RouterClient<AppRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(orpcClient);
