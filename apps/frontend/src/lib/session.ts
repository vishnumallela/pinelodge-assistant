import { queryOptions } from "@tanstack/react-query";
import { getSession } from "./auth-client";

async function fetchSession() {
  const { data } = await getSession();
  return data ?? null;
}

export const sessionQuery = queryOptions({
  queryKey: ["auth", "session"] as const,
  queryFn: fetchSession,
  staleTime: 30_000,
});
