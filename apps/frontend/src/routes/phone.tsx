import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Copy, PhoneCall, PhoneForwarded } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { orpc, type PhoneConfig } from "@/lib/orpc";
import { AGENT_NAME } from "@/lib/receptionist-agent";
import { cn } from "@/lib/utils";

function CopyField({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border/70 bg-secondary/50 px-3 py-2 text-[12.5px] text-foreground">
          {value}
        </code>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setDone(true);
            window.setTimeout(() => setDone(false), 1200);
          }}
        >
          {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
        {n}
      </span>
      <span className="text-[13.5px] leading-relaxed text-foreground">{children}</span>
    </li>
  );
}

export function PhonePage() {
  const { data: config } = useQuery(orpc.phone.config.queryOptions());

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="mx-auto w-full max-w-4xl px-5 py-10 md:px-6">
        <header className="space-y-1">
          <h1 className="font-display text-[34px] leading-none text-foreground">Phone line</h1>
          <p className="text-[14px] text-muted-foreground">
            Put {AGENT_NAME} on a real phone number.
          </p>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="mt-8 space-y-6"
        >
          <TwilioSection config={config} />
          <SipSection config={config} />
        </motion.div>
      </div>
    </main>
  );
}

function TwilioSection({ config }: { config: PhoneConfig | undefined }) {
  const t = config?.twilio;
  return (
    <section className="rounded-2xl border border-brand/25 bg-card p-6 shadow-[0_1px_2px_rgba(154,106,47,0.08)]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <PhoneCall className="size-4 text-brand" />
          <h2 className="text-[15px] font-medium text-foreground">Twilio</h2>
          <Badge variant="brand">Recommended</Badge>
        </div>
        {t?.enabled ? (
          <Badge variant="success">Ready for calls</Badge>
        ) : (
          <Badge variant="muted">Needs TWILIO_AUTH_TOKEN</Badge>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        A Twilio number streams call audio into the same session the console uses, with the live
        prompt, call log, and summaries.
      </p>

      <div className="mt-5">
        <CopyField label="Voice webhook" value={t?.voiceWebhookUrl ?? "Loading"} />
      </div>

      <ol className="mt-6 space-y-3">
        <Step n={1}>Buy a voice number in the Twilio Console.</Step>
        <Step n={2}>
          Set your Twilio Auth Token as{" "}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-[12px]">TWILIO_AUTH_TOKEN</code>{" "}
          on the api-gateway.
        </Step>
        <Step n={3}>
          Point the number at the voice webhook above: Voice Configuration, A call comes in,
          Webhook, HTTP POST.
        </Step>
        <Step n={4}>Call the number. The call appears live in the call log.</Step>
      </ol>
    </section>
  );
}

function SipSection({ config }: { config: PhoneConfig | undefined }) {
  const qc = useQueryClient();
  const sip = config?.sip;

  const [form, setForm] = useState({
    phoneNumber: "",
    name: "Front desk",
    authMethod: "addresses" as "addresses" | "credentials",
    authUsername: "",
    authPassword: "",
    allowedAddresses: "",
  });
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const register = useMutation({
    mutationFn: () =>
      orpc.phone.registerSip.call({
        phoneNumber: form.phoneNumber.trim(),
        name: form.name.trim() || "Front desk",
        ...(form.authMethod === "credentials"
          ? { authUsername: form.authUsername.trim(), authPassword: form.authPassword }
          : {
              allowedAddresses: form.allowedAddresses
                .split(/[\n,]/)
                .map((s) => s.trim())
                .filter(Boolean),
            }),
      }),
    onSuccess: ({ secret }) => {
      setRevealedSecret(secret || null);
      void qc.invalidateQueries({ queryKey: orpc.phone.config.key() });
      toast.success("Number registered with xAI.");
    },
    onError: (e) => toast.error(e.message),
  });

  const valid =
    /^\+[1-9]\d{6,14}$/.test(form.phoneNumber.trim()) &&
    (form.authMethod === "credentials"
      ? form.authUsername.trim() !== "" && form.authPassword !== ""
      : form.allowedAddresses.trim() !== "");

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(33,28,24,0.04)]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <PhoneForwarded className="size-4 text-muted-foreground" />
          <h2 className="text-[15px] font-medium text-foreground">xAI Direct SIP</h2>
          <Badge variant="outline">Requires Agents beta</Badge>
        </div>
        {sip?.enabled ? (
          <Badge variant="success">Ready for calls</Badge>
        ) : (
          <Badge variant="muted">Not registered</Badge>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        Point any carrier straight at xAI, no Twilio in the path. Registration needs the xAI Agents
        API enabled for your team. If it returns a 403, request access from xAI and retry here.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <CopyField label="Incoming-call webhook" value={sip?.webhookUrl ?? "Loading"} />
        <CopyField
          label="SIP destination for carriers"
          value={`sip:{number}@${sip?.sipHost ?? "sip.voice.x.ai"};transport=tls`}
        />
      </div>
      {sip?.hasSecret && (
        <p className="mt-3 text-[12.5px] text-muted-foreground">
          Webhook signing secret configured
          {sip.secretSource === "env" ? " via XAI_SIP_WEBHOOK_SECRET." : " from registration."}
        </p>
      )}

      {(sip?.numbers.length ?? 0) > 0 && (
        <div className="mt-5 rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Number</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="pr-4">Registered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sip!.numbers.map((n) => (
                <TableRow key={n.phoneNumberId || n.phoneNumber}>
                  <TableCell className="pl-4 text-[13.5px] font-medium tabular-nums">
                    {n.phoneNumber}
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">{n.name}</TableCell>
                  <TableCell className="pr-4 text-[12.5px] tabular-nums text-muted-foreground">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="sip-number">Phone number (E.164)</Label>
          <Input
            id="sip-number"
            placeholder="+14155550100"
            value={form.phoneNumber}
            onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sip-name">Label</Label>
          <Input
            id="sip-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <Label>SIP authentication</Label>
        <div className="flex gap-1.5">
          {(
            [
              ["addresses", "Allowed addresses"],
              ["credentials", "Digest credentials"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={form.authMethod === key}
              onClick={() => setForm((f) => ({ ...f, authMethod: key }))}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
                form.authMethod === key
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-border bg-card text-muted-foreground pf-hover:bg-accent",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {form.authMethod === "addresses" ? (
        <div className="mt-4 space-y-1.5">
          <Label htmlFor="sip-addresses">Provider signaling CIDR ranges</Label>
          <Textarea
            id="sip-addresses"
            rows={3}
            placeholder={"54.172.60.0/23\n54.244.51.0/24"}
            value={form.allowedAddresses}
            onChange={(e) => setForm((f) => ({ ...f, allowedAddresses: e.target.value }))}
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sip-user">Username</Label>
            <Input
              id="sip-user"
              autoComplete="off"
              value={form.authUsername}
              onChange={(e) => setForm((f) => ({ ...f, authUsername: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sip-pass">Password</Label>
            <Input
              id="sip-pass"
              type="password"
              autoComplete="new-password"
              value={form.authPassword}
              onChange={(e) => setForm((f) => ({ ...f, authPassword: e.target.value }))}
            />
          </div>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button
          variant="outline"
          disabled={!valid || register.isPending || !sip?.hasApiKey}
          onClick={() => register.mutate()}
        >
          {register.isPending ? "Registering" : "Register with xAI"}
        </Button>
      </div>

      {revealedSecret && (
        <div className="mt-5 rounded-xl border border-brand/30 bg-brand-soft/50 p-4">
          <p className="text-[13px] font-medium text-foreground">Webhook signing secret</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            Shown once and already stored on the server. Copy it if you want it in
            XAI_SIP_WEBHOOK_SECRET for other environments.
          </p>
          <div className="mt-2">
            <CopyField label="Signing secret" value={revealedSecret} />
          </div>
        </div>
      )}
    </section>
  );
}
