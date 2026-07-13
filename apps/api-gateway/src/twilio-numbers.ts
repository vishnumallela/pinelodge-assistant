import { env } from "./env";

/**
 * Twilio phone-number management over the plain REST API (no SDK, matching
 * the hand-rolled webhook side): list the numbers the account owns, search
 * the catalog, buy one, point its voice webhook here, release it. Enabled by
 * TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN; without the SID the bridge still
 * works, numbers just have to be wired up in the Twilio console by hand.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export function twilioNumbersEnabled(): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

class TwilioApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function authHeader(): string {
  const creds = `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`;
  return `Basic ${Buffer.from(creds).toString("base64")}`;
}

async function twilioFetch(
  path: string,
  init: { method?: string; form?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  if (!twilioNumbersEnabled()) {
    throw new TwilioApiError(503, "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN first.");
  }
  const res = await fetch(`${TWILIO_API}/Accounts/${env.TWILIO_ACCOUNT_SID}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: authHeader(),
      ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 204) return {};
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const message =
      String(data.message ?? text ?? "").slice(0, 300) || `Twilio error ${res.status}`;
    throw new TwilioApiError(res.status, message);
  }
  return data;
}

export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string;
}

interface RawIncomingNumber {
  sid?: string;
  phone_number?: string;
  friendly_name?: string;
  voice_url?: string;
}

function toOwnedNumber(raw: RawIncomingNumber): OwnedNumber {
  return {
    sid: raw.sid ?? "",
    phoneNumber: raw.phone_number ?? "",
    friendlyName: raw.friendly_name ?? "",
    voiceUrl: raw.voice_url ?? "",
  };
}

/** Every voice number the Twilio account owns. */
export async function listOwnedNumbers(): Promise<OwnedNumber[]> {
  const data = await twilioFetch("/IncomingPhoneNumbers.json?PageSize=200");
  const rows = (data.incoming_phone_numbers as RawIncomingNumber[] | undefined) ?? [];
  return rows.map((raw) => toOwnedNumber(raw));
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

interface RawAvailableNumber {
  phone_number?: string;
  friendly_name?: string;
  locality?: string;
  region?: string;
}

/** Search the Twilio catalog for purchasable local voice numbers. */
export async function searchAvailableNumbers(input: {
  country: string;
  areaCode?: string;
  contains?: string;
}): Promise<AvailableNumber[]> {
  const params = new URLSearchParams({ VoiceEnabled: "true", PageSize: "20" });
  if (input.areaCode) params.set("AreaCode", input.areaCode);
  if (input.contains) params.set("Contains", input.contains);
  const data = await twilioFetch(
    `/AvailablePhoneNumbers/${encodeURIComponent(input.country)}/Local.json?${params.toString()}`,
  );
  const rows = (data.available_phone_numbers as RawAvailableNumber[] | undefined) ?? [];
  return rows.map((raw) => ({
    phoneNumber: raw.phone_number ?? "",
    friendlyName: raw.friendly_name ?? "",
    locality: raw.locality ?? "",
    region: raw.region ?? "",
  }));
}

/** Buy a number and point its voice webhook at this deployment in one step. */
export async function purchaseNumber(input: {
  phoneNumber: string;
  voiceUrl: string;
  friendlyName: string;
}): Promise<OwnedNumber> {
  const data = await twilioFetch("/IncomingPhoneNumbers.json", {
    method: "POST",
    form: {
      PhoneNumber: input.phoneNumber,
      VoiceUrl: input.voiceUrl,
      VoiceMethod: "POST",
      FriendlyName: input.friendlyName,
    },
  });
  return toOwnedNumber(data as RawIncomingNumber);
}

/** Re-point an owned number's voice webhook (and optionally rename it). */
export async function configureNumber(
  sid: string,
  input: { voiceUrl: string; friendlyName?: string },
): Promise<OwnedNumber> {
  const data = await twilioFetch(`/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`, {
    method: "POST",
    form: {
      VoiceUrl: input.voiceUrl,
      VoiceMethod: "POST",
      ...(input.friendlyName ? { FriendlyName: input.friendlyName } : {}),
    },
  });
  return toOwnedNumber(data as RawIncomingNumber);
}

/** Release the number back to Twilio — it stops billing and stops ringing. */
export async function releaseNumber(sid: string): Promise<void> {
  await twilioFetch(`/IncomingPhoneNumbers/${encodeURIComponent(sid)}.json`, { method: "DELETE" });
}

/** Human-readable message for surfacing Twilio API failures to the UI. */
export function twilioErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Twilio request failed.";
}
