import { ORPCError, os } from "@orpc/server";
import { z } from "zod";
import { createCall, endCall, getCall, listCallsPage, logCallEvent, saveTranscript } from "./calls";
import { env } from "./env";
import { DEFAULT_GREETING, DEFAULT_TEMPLATE, getAgentPrompt, saveTemplate } from "./prompt";
import { enqueueSummary, enqueueTransferEmail } from "./queue";
import { getSipSecret, listRegisteredNumbers, registerNumber } from "./sip";
import { createStaff, deleteStaff, findRedirectTarget, listStaff, updateStaff } from "./staff";
import { twilioEnabled } from "./twilio";

/**
 * Typed API surface for the dashboard, mounted at /orpc. The context carries
 * whether the session belongs to the single admin (resolved in server.ts) and
 * the deployment's public origin (for webhook URLs).
 */

export interface RpcContext {
  admin: boolean;
  origin: string;
}

const base = os.$context<RpcContext>();

const authed = base.use(({ context, next }) => {
  if (!context.admin) throw new ORPCError("UNAUTHORIZED", { message: "Sign in to continue." });
  return next();
});

const transcriptSchema = z.array(
  z.object({ role: z.enum(["caller", "assistant"]), text: z.string() }),
);

const staffInputSchema = z.object({
  name: z.string().trim().min(1),
  section: z.string().trim().min(1),
  handles: z.string().trim().default(""),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/)
    .or(z.literal(""))
    .default(""),
  email: z.string().trim().toLowerCase().email().or(z.literal("")).default(""),
  days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timeOff: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).default([]),
  isFallback: z.boolean().default(false),
  active: z.boolean().default(true),
  sort: z.number().int().optional(),
});

export const router = {
  calls: {
    list: authed
      .input(
        z.object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(5).max(100).default(20),
        }),
      )
      .handler(({ input }) => listCallsPage(input.page, input.pageSize)),

    get: authed.input(z.object({ id: z.string().uuid() })).handler(async ({ input }) => {
      const call = await getCall(input.id);
      if (!call) throw new ORPCError("NOT_FOUND", { message: "Call not found." });
      return call;
    }),

    create: authed.handler(async () => {
      const call = await createCall("console");
      await logCallEvent(call.id, "call created", "console");
      return call;
    }),

    saveTranscript: authed
      .input(z.object({ id: z.string().uuid(), transcript: transcriptSchema }))
      .handler(async ({ input }) => {
        const ok = await saveTranscript(input.id, input.transcript);
        if (!ok) throw new ORPCError("CONFLICT", { message: "Call is locked or not found." });
        return { ok: true };
      }),

    end: authed
      .input(z.object({ id: z.string().uuid(), transcript: transcriptSchema }))
      .handler(async ({ input }) => {
        const row = await endCall(input.id, input.transcript);
        if (!row) throw new ORPCError("CONFLICT", { message: "Call is locked or not found." });
        await logCallEvent(input.id, "call ended", `console, ${row.durationSeconds ?? 0}s`);
        await enqueueSummary({ callId: row.id });
        return row;
      }),

    /** Sarah's console transfer_call: the redirect is announce-only (no dial
     *  leg), but the named staff member is briefed by email immediately. */
    transfer: authed
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().trim().min(1),
          transcript: transcriptSchema,
        }),
      )
      .handler(async ({ input }) => {
        // Persist the turns spoken so far; a locked call can't transfer.
        const saved = await saveTranscript(input.id, input.transcript);
        if (!saved) throw new ORPCError("CONFLICT", { message: "Call is locked or not found." });
        const target = await findRedirectTarget(input.name);
        if (!target) {
          await logCallEvent(
            input.id,
            "transfer failed",
            `asked for "${input.name}", nobody available`,
          );
          return {
            ok: false as const,
            error: "Nobody is available to take this transfer right now.",
          };
        }
        await logCallEvent(input.id, "transfer announced", `${target.name} (${target.section})`);
        await enqueueTransferEmail({
          callId: input.id,
          target: { name: target.name, section: target.section, email: target.email },
          transcript: input.transcript,
          sourceLabel: "Console call",
          transferredAt: new Date().toISOString(),
        });
        return { ok: true as const, connecting: `${target.name} in ${target.section}` };
      }),
  },

  staff: {
    list: authed.handler(() => listStaff()),
    create: authed.input(staffInputSchema).handler(({ input }) => createStaff(input)),
    update: authed
      .input(z.object({ id: z.string().uuid(), data: staffInputSchema }))
      .handler(async ({ input }) => {
        const row = await updateStaff(input.id, input.data);
        if (!row) throw new ORPCError("NOT_FOUND", { message: "Staff member not found." });
        return row;
      }),
    remove: authed.input(z.object({ id: z.string().uuid() })).handler(async ({ input }) => {
      const ok = await deleteStaff(input.id);
      if (!ok) throw new ORPCError("NOT_FOUND", { message: "Staff member not found." });
      return { ok: true };
    }),
  },

  prompt: {
    get: authed.handler(async () => ({
      ...(await getAgentPrompt()),
      defaults: { template: DEFAULT_TEMPLATE, greeting: DEFAULT_GREETING },
    })),
    save: authed
      .input(z.object({ template: z.string().trim().min(1), greeting: z.string().trim().min(1) }))
      .handler(async ({ input }) => {
        await saveTemplate(input.template, input.greeting);
        return {
          ...(await getAgentPrompt()),
          defaults: { template: DEFAULT_TEMPLATE, greeting: DEFAULT_GREETING },
        };
      }),
  },

  phone: {
    config: authed.handler(async ({ context }) => {
      const secret = await getSipSecret();
      return {
        twilio: {
          enabled: twilioEnabled(),
          hasApiKey: Boolean(env.XAI_API_KEY),
          voiceWebhookUrl: `${context.origin}/api/twilio/incoming`,
          streamUrl: `${context.origin.replace(/^http/, "ws")}/api/twilio/stream`,
        },
        sip: {
          enabled: Boolean(secret && env.XAI_API_KEY),
          hasApiKey: Boolean(env.XAI_API_KEY),
          hasSecret: Boolean(secret),
          secretSource: env.XAI_SIP_WEBHOOK_SECRET
            ? ("env" as const)
            : secret
              ? ("registered" as const)
              : null,
          webhookUrl: `${context.origin}/api/sip/incoming`,
          sipHost: "sip.voice.x.ai",
          numbers: (await listRegisteredNumbers()) ?? [],
        },
      };
    }),

    registerSip: authed
      .input(
        z.object({
          phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, "Use E.164, e.g. +14155550100."),
          name: z.string().trim().min(1).default("Front desk"),
          authUsername: z.string().trim().optional(),
          authPassword: z.string().optional(),
          allowedAddresses: z.array(z.string().trim().min(1)).optional(),
        }),
      )
      .handler(async ({ input, context }) => {
        const result = await registerNumber(input, `${context.origin}/api/sip/incoming`);
        if ("error" in result) {
          throw new ORPCError(result.status === 400 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR", {
            message: result.error,
          });
        }
        return result;
      }),
  },
};

export type AppRouter = typeof router;
