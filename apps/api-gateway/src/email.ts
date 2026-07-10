import { createEmailClient } from "@opencoredev/email-sdk";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { renderTransferEmail } from "./emails/transfer-notification";
import { env } from "./env";
import type { CallSummary } from "./schema";

/**
 * Outbound email over the SMTP relay from env, via the Email SDK. The feature
 * is optional: without SMTP_HOST + EMAIL_FROM nothing sends and transfers
 * behave exactly as before.
 */

export function emailEnabled(): boolean {
  return Boolean(env.SMTP_HOST && env.EMAIL_FROM);
}

let client: ReturnType<typeof createEmailClient> | null = null;

function getClient(): ReturnType<typeof createEmailClient> {
  if (!client) {
    client = createEmailClient({
      adapters: [
        smtp({
          host: env.SMTP_HOST!,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          // Credentials (and call content) never travel plaintext: on a
          // STARTTLS port, insist on the upgrade whenever auth is configured.
          requireTLS: Boolean(!env.SMTP_SECURE && env.SMTP_USER && env.SMTP_PASS),
          ...(env.SMTP_USER && env.SMTP_PASS
            ? {
                auth: {
                  user: env.SMTP_USER,
                  pass: env.SMTP_PASS,
                  method: env.SMTP_AUTH_METHOD,
                },
              }
            : {}),
        }),
      ],
      // The BullMQ job already retries with backoff; don't stack retries here.
      retry: { retries: 0 },
    });
  }
  return client;
}

export interface TransferEmailInput {
  to: string;
  staffName: string;
  summary: CallSummary;
  sourceLabel: string;
  transferredAt: Date;
  callId: string;
}

/** Format the transfer moment in facility time, e.g. "2:41 PM CDT". */
function facilityTimeLabel(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: env.FACILITY_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

export async function sendTransferEmail(input: TransferEmailInput): Promise<void> {
  const origin = env.ALLOWED_ORIGINS[0];
  const { html, text } = await renderTransferEmail({
    staffName: input.staffName,
    facilityName: env.FACILITY_NAME,
    summary: input.summary,
    sourceLabel: input.sourceLabel,
    transferredAtLabel: facilityTimeLabel(input.transferredAt),
    ...(origin ? { callUrl: `${origin}/calls/${input.callId}` } : {}),
  });
  await getClient().send({
    from: env.EMAIL_FROM!,
    to: input.to,
    subject: `Call transfer: ${input.summary.headline}`,
    html,
    text,
  });
}
