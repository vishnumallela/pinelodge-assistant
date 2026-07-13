import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "@pinelodge/api-gateway/router";
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

export const client: RouterClient<AppRouter> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

/* Types inferred straight from the router — the server is the source of
 * truth (dates arrive as real Date objects over the oRPC serializer). */
export type Call = Awaited<ReturnType<typeof client.calls.get>>;
export type CallStatus = Call["status"];
export type TranscriptTurn = Call["transcript"][number];
export type Center = Awaited<ReturnType<typeof client.centers.list>>[number];
export type StaffMember = Awaited<ReturnType<typeof client.staff.list>>[number];
export type AttachablePerson = Awaited<ReturnType<typeof client.staff.people>>[number];
type StaffCreateData = Parameters<typeof client.staff.create>[0]["data"];
/** Editor form shape: the zod defaults are optional on the wire, but the
 *  form always carries concrete values. */
export type StaffInput = Required<Omit<StaffCreateData, "sort">> & Pick<StaffCreateData, "sort">;
export type PhoneConfig = Awaited<ReturnType<typeof client.phone.config>>;
export type OwnedNumber = Awaited<ReturnType<typeof client.phone.numbers.list>>[number];
export type AvailableNumber = Awaited<ReturnType<typeof client.phone.numbers.search>>[number];
export type SettingsField = Awaited<ReturnType<typeof client.settings.get>>[number];
export type MessageCall = Awaited<ReturnType<typeof client.messages.list>>["calls"][number];

/** Human label for where a call came from. */
export function callSource(call: Pick<Call, "userId">): string {
  if (call.userId.startsWith("phone:")) return call.userId.slice("phone:".length);
  // Rows recorded before the Direct SIP path was removed.
  if (call.userId.startsWith("sip:")) return call.userId.slice("sip:".length);
  return "Console";
}
