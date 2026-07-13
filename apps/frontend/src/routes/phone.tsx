import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Check, Copy, PhoneCall } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { orpc, type PhoneConfig } from "@/lib/orpc";
import { AGENT_NAME } from "@/lib/receptionist-agent";

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
        </motion.div>
      </div>
    </main>
  );
}

function TwilioSection({ config }: { config: PhoneConfig | undefined }) {
  const t = config?.twilio;
  return (
    <section className="rounded-2xl border border-brand/25 bg-card p-6 shadow-card">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <PhoneCall className="size-4 text-brand" />
          <h2 className="text-[15px] font-medium text-foreground">Twilio</h2>
        </div>
        {t?.enabled ? (
          <Badge variant="success">Ready for calls</Badge>
        ) : (
          <Badge variant="muted">Needs TWILIO_AUTH_TOKEN</Badge>
        )}
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        A Twilio number streams call audio into the same session the console uses, with the live
        prompt, call log, and summaries. Transfers dial the staff member's line through Twilio. The
        dialed number decides which center answers — give each center its own number on the{" "}
        <Link to="/centers" className="text-brand underline-offset-2 pf-hover:underline">
          Centers
        </Link>{" "}
        page.
      </p>

      <div className="mt-5">
        <CopyField label="Voice webhook" value={t?.voiceWebhookUrl ?? "Loading"} />
      </div>

      <ol className="mt-6 space-y-3">
        <Step n={1}>
          Add your Twilio Auth Token in{" "}
          <Link to="/settings" className="text-brand underline-offset-2 pf-hover:underline">
            Settings
          </Link>
          .
        </Step>
        <Step n={2}>
          Add the Account SID there too — then each center can search, buy, and wire up its number
          from the Centers page with no Twilio console work.
          {t?.numbersEnabled === true && " (Detected — number management is on.)"}
        </Step>
        <Step n={3}>
          Without the SID: buy a voice number in the Twilio Console, point it at the voice webhook
          above (Voice Configuration, A call comes in, Webhook, HTTP POST), and enter the number on
          the center so calls route to it.
        </Step>
        <Step n={4}>Call the number. The call appears live in that center's call log.</Step>
      </ol>
    </section>
  );
}
