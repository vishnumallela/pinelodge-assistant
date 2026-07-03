import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { env } from "./env";
import { BEARER_KEY } from "./bearer";

export const authClient = createAuthClient({
  baseURL: env.AUTH_URL,
  plugins: [usernameClient()],
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

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
