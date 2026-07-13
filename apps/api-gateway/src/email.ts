import { createEmailClient } from "@opencoredev/email-sdk";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { getConfig, type AppConfig } from "./app-config";
import { renderTransferEmail } from "./emails/transfer-notification";
import { env } from "./env";
import type { CallSummary } from "./schema";

/**
 * Outbound email over the SMTP relay from Settings (env as fallback), via
 * the Email SDK. The feature is optional: without an SMTP host + from
 * address nothing sends and transfers behave exactly as before.
 */

export async function emailEnabled(): Promise<boolean> {
  const config = await getConfig();
  return Boolean(config.smtpHost && config.emailFrom);
}

/** The client rebuilds whenever the SMTP settings change, so a dashboard
 *  edit applies to the next email without a restart. */
let cached: { signature: string; client: ReturnType<typeof createEmailClient> } | null = null;

function getClient(config: AppConfig): ReturnType<typeof createEmailClient> {
  const signature = JSON.stringify([
    config.smtpHost,
    config.smtpPort,
    config.smtpSecure,
    config.smtpUser,
    config.smtpPass,
    config.smtpAuthMethod,
  ]);
  if (cached?.signature !== signature) {
    cached = {
      signature,
      client: createEmailClient({
        adapters: [
          smtp({
            host: config.smtpHost,
            port: config.smtpPort,
            secure: config.smtpSecure,
            // Credentials (and call content) never travel plaintext: on a
            // STARTTLS port, insist on the upgrade whenever auth is configured.
            requireTLS: Boolean(!config.smtpSecure && config.smtpUser && config.smtpPass),
            ...(config.smtpUser && config.smtpPass
              ? {
                  auth: {
                    user: config.smtpUser,
                    pass: config.smtpPass,
                    method: config.smtpAuthMethod,
                  },
                }
              : {}),
          }),
        ],
        // The BullMQ job already retries with backoff; don't stack retries here.
        retry: { retries: 0 },
      }),
    };
  }
  return cached.client;
}

export interface TransferEmailInput {
  to: string;
  staffName: string;
  summary: CallSummary;
  sourceLabel: string;
  transferredAt: Date;
  callId: string;
  /** The receiving center; the env FACILITY_* pair covers legacy jobs. */
  center?: { name: string; timezone: string };
}

/** Format the transfer moment in the center's time, e.g. "2:41 PM CDT". */
function centerTimeLabel(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/** Email copy stays plain: em dashes become commas, en dashes hyphens. */
function cleanText(s: string): string {
  return s
    .replaceAll(/\s*—\s*/g, ", ")
    .replaceAll("–", "-")
    .replace(/^, /, "")
    .trim();
}

function cleanSummary(s: CallSummary): CallSummary {
  return {
    headline: cleanText(s.headline),
    caller: cleanText(s.caller),
    keyPoints: s.keyPoints.map(cleanText),
    outcome: cleanText(s.outcome),
    followUp: cleanText(s.followUp),
  };
}

export async function sendTransferEmail(input: TransferEmailInput): Promise<void> {
  const config = await getConfig();
  const origin = config.appUrl || env.ALLOWED_ORIGINS[0];
  const summary = cleanSummary(input.summary);
  const { html, text } = await renderTransferEmail({
    staffName: input.staffName,
    facilityName: input.center?.name ?? env.FACILITY_NAME,
    summary,
    sourceLabel: input.sourceLabel,
    transferredAtLabel: centerTimeLabel(
      input.transferredAt,
      input.center?.timezone ?? env.FACILITY_TIMEZONE,
    ),
    ...(origin ? { callUrl: `${origin}/calls/${input.callId}` } : {}),
  });
  await getClient(config).send({
    from: config.emailFrom,
    to: input.to,
    subject: `Call transfer: ${summary.headline}`,
    html,
    text,
  });
}
