import twilio from "twilio";
import { env } from "./env";

/**
 * Twilio phone-number management through the official SDK: list the numbers
 * the account owns, search the catalog, buy one, point its voice webhook
 * here, release it. Enabled by TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN;
 * without the SID the bridge still works, numbers just have to be wired up
 * in the Twilio console by hand.
 */

export function twilioNumbersEnabled(): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

let client: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (!twilioNumbersEnabled()) {
    throw new Error("Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN first.");
  }
  if (!client) client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  return client;
}

export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string;
}

/** Every voice number the Twilio account owns. */
export async function listOwnedNumbers(): Promise<OwnedNumber[]> {
  const rows = await getClient().incomingPhoneNumbers.list({ limit: 200 });
  return rows.map((r) => ({
    sid: r.sid,
    phoneNumber: r.phoneNumber,
    friendlyName: r.friendlyName ?? "",
    voiceUrl: r.voiceUrl ?? "",
  }));
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

/** Search the Twilio catalog for purchasable local voice numbers. */
export async function searchAvailableNumbers(input: {
  country: string;
  areaCode?: string;
  contains?: string;
}): Promise<AvailableNumber[]> {
  const rows = await getClient()
    .availablePhoneNumbers(input.country)
    .local.list({
      voiceEnabled: true,
      limit: 20,
      ...(input.areaCode ? { areaCode: Number(input.areaCode) } : {}),
      ...(input.contains ? { contains: input.contains } : {}),
    });
  return rows.map((r) => ({
    phoneNumber: r.phoneNumber,
    friendlyName: r.friendlyName ?? "",
    locality: r.locality ?? "",
    region: r.region ?? "",
  }));
}

/** Buy a number and point its voice webhook at this deployment in one step. */
export async function purchaseNumber(input: {
  phoneNumber: string;
  voiceUrl: string;
  friendlyName: string;
}): Promise<OwnedNumber> {
  const r = await getClient().incomingPhoneNumbers.create({
    phoneNumber: input.phoneNumber,
    voiceUrl: input.voiceUrl,
    voiceMethod: "POST",
    friendlyName: input.friendlyName,
  });
  return {
    sid: r.sid,
    phoneNumber: r.phoneNumber,
    friendlyName: r.friendlyName ?? "",
    voiceUrl: r.voiceUrl ?? "",
  };
}

/** Re-point an owned number's voice webhook (and optionally rename it). */
export async function configureNumber(
  sid: string,
  input: { voiceUrl: string; friendlyName?: string },
): Promise<OwnedNumber> {
  const r = await getClient()
    .incomingPhoneNumbers(sid)
    .update({
      voiceUrl: input.voiceUrl,
      voiceMethod: "POST",
      ...(input.friendlyName ? { friendlyName: input.friendlyName } : {}),
    });
  return {
    sid: r.sid,
    phoneNumber: r.phoneNumber,
    friendlyName: r.friendlyName ?? "",
    voiceUrl: r.voiceUrl ?? "",
  };
}

/** Release the number back to Twilio — it stops billing and stops ringing. */
export async function releaseNumber(sid: string): Promise<void> {
  await getClient().incomingPhoneNumbers(sid).remove();
}

/** Human-readable message for surfacing Twilio API failures to the UI. */
export function twilioErrorMessage(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status === 401) {
    return "Twilio rejected the credentials — check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.";
  }
  return e instanceof Error ? e.message : "Twilio request failed.";
}
