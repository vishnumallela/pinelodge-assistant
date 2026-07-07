import { createAuthClient } from "better-auth/react";
import { env } from "./env";
import { BEARER_KEY } from "./bearer";

const authClient = createAuthClient({
  baseURL: env.AUTH_URL,
  fetchOptions: {
    credentials: "include",
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) localStorage.setItem(BEARER_KEY, token);
    },
    auth: {
      type: "Bearer",
      token: () => localStorage.getItem(BEARER_KEY) ?? "",
    },
  },
});

export const { signIn, signOut, useSession, getSession } = authClient;
