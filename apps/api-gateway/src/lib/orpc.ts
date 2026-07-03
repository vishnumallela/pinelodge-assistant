import { ORPCError, os } from "@orpc/server";
import { env } from "../env";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface Ctx {
  headers: Headers;
}

const base = os.$context<Ctx>();

export const pub = base;

// Identity lives in the auth service. Resolve the current user by forwarding the
// request's cookie (or Authorization) to the auth service's get-session.
async function resolveUser(headers: Headers): Promise<SessionUser> {
  const cookie = headers.get("cookie");
  const authz = headers.get("authorization");
  if (!cookie && !authz) throw new ORPCError("UNAUTHORIZED", { message: "Please sign in." });

  const res = await fetch(`${env.AUTH_URL}/api/auth/get-session`, {
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authz ? { authorization: authz } : {}),
    },
    signal: AbortSignal.timeout(5000),
  });
  const data = res.ok ? ((await res.json()) as { user?: Record<string, unknown> } | null) : null;
  if (!data?.user) throw new ORPCError("UNAUTHORIZED", { message: "Please sign in." });
  const u = data.user;
  return {
    id: String(u.id),
    email: String(u.email ?? ""),
    name: String(u.name ?? ""),
  };
}

export const authed = base.use(async ({ context, next }) => {
  const user = await resolveUser(context.headers);
  return next({ context: { ...context, user } });
});
