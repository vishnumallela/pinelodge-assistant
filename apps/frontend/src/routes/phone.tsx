import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Check, Copy, PhoneForwarded } from "lucide-react";
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
import { getSipConfig, registerSipNumber } from "@/lib/sip-api";
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

export function PhonePage() {
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ["sip-config"], queryFn: getSipConfig });

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
      registerSipNumber({
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
      void qc.invalidateQueries({ queryKey: ["sip-config"] });
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
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="mx-auto w-full max-w-4xl px-5 py-10 md:px-6">
        <header className="space-y-1">
          <h1 className="font-display text-[34px] leading-none text-foreground">Phone line</h1>
          <p className="text-[14px] text-muted-foreground">
            Route a real phone number into {AGENT_NAME} over SIP. Register the number with xAI here,
            then point your carrier at the SIP address below.
          </p>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="mt-8 space-y-6"
        >
          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(33,28,24,0.04)]">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1 rounded-full bg-brand" aria-hidden />
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  Status
                </h2>
              </div>
              {config?.enabled ? (
                <Badge variant="success">Ready for calls</Badge>
              ) : config?.hasApiKey ? (
                <Badge variant="muted">No number registered</Badge>
              ) : (
                <Badge variant="destructive">XAI_API_KEY missing</Badge>
              )}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <CopyField label="Incoming-call webhook" value={config?.webhookUrl ?? "…"} />
              <CopyField label="SIP host" value={config?.sipHost ?? "sip.voice.x.ai"} />
            </div>
            {config?.hasSecret && (
              <p className="mt-4 text-[12.5px] text-muted-foreground">
                Webhook signing secret configured
                {config.secretSource === "env"
                  ? " via XAI_SIP_WEBHOOK_SECRET."
                  : " from registration."}
              </p>
            )}
          </section>

          {(config?.numbers.length ?? 0) > 0 && (
            <section className="rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(33,28,24,0.04)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Number</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Point your carrier at</TableHead>
                    <TableHead className="pr-5">Registered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {config!.numbers.map((n) => (
                    <TableRow key={n.phoneNumberId || n.phoneNumber}>
                      <TableCell className="pl-5 text-[14px] font-medium tabular-nums text-foreground">
                        {n.phoneNumber}
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">{n.name}</TableCell>
                      <TableCell>
                        <code className="text-[12px] text-foreground">
                          sip:{n.phoneNumber}@{n.sipHost};transport=tls
                        </code>
                      </TableCell>
                      <TableCell className="pr-5 text-[12.5px] tabular-nums text-muted-foreground">
                        {new Date(n.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(33,28,24,0.04)]">
            <div className="flex items-center gap-2">
              <PhoneForwarded className="size-4 text-brand" />
              <h2 className="text-[15px] font-medium text-foreground">Register a number</h2>
            </div>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Bring your own number (byo_trunk). xAI creates the webhook route and returns the
              signing secret once — it&rsquo;s stored here automatically.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
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

            <div className="mt-5 space-y-2">
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
                <p className="text-[12px] text-muted-foreground">
                  One per line — your carrier&rsquo;s SIP signaling ranges (e.g. Twilio&rsquo;s
                  gateway CIDRs).
                </p>
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
                  <p className="text-[12px] text-muted-foreground">
                    Configure your carrier with the same pair; xAI never returns it again.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button
                disabled={!valid || register.isPending || !config?.hasApiKey}
                onClick={() => register.mutate()}
                className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
              >
                {register.isPending ? "Registering…" : "Register with xAI"}
              </Button>
            </div>

            {revealedSecret && (
              <div className="mt-5 rounded-xl border border-brand/30 bg-brand-soft/50 p-4">
                <p className="text-[13px] font-medium text-foreground">
                  Webhook signing secret — shown once
                </p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Already stored on the server. Copy it if you also want it in
                  XAI_SIP_WEBHOOK_SECRET for other environments.
                </p>
                <div className="mt-2">
                  <CopyField label="Signing secret" value={revealedSecret} />
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(33,28,24,0.04)]">
            <h2 className="text-[15px] font-medium text-foreground">Point your carrier here</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Every provider routes to the same destination — replace the number with yours.
            </p>
            <div className="mt-4">
              <CopyField
                label="SIP destination"
                value={`sip:{number}@${config?.sipHost ?? "sip.voice.x.ai"};transport=tls`}
              />
            </div>
            <dl className="mt-5 space-y-3 text-[13px] leading-relaxed">
              <div>
                <dt className="font-medium text-foreground">Twilio</dt>
                <dd className="text-muted-foreground">
                  Voice → Elastic SIP Trunking → create a trunk → Origination URI above → attach
                  your number.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Telnyx</dt>
                <dd className="text-muted-foreground">
                  Voice Suite → SIP Trunking → FQDN connection to{" "}
                  {config?.sipHost ?? "sip.voice.x.ai"} on port 5060 (A record), E.164 inbound
                  format, G.711 μ-law enabled.
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Plivo / PBX</dt>
                <dd className="text-muted-foreground">
                  Create an inbound trunk or outbound route with the SIP destination above.
                </dd>
              </div>
            </dl>
          </section>
        </motion.div>
      </div>
    </main>
  );
}
