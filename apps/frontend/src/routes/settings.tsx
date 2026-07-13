import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Mail, Mic, PhoneCall, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { orpc, type SettingsField } from "@/lib/orpc";

/**
 * Application settings, stored in Postgres and applied to the next call —
 * no redeploys. Every field falls back to its env var when cleared, so
 * env-configured deployments keep working untouched. The form renders from
 * the server's field metadata; nothing here is hardcoded per key.
 */

const GROUPS = [
  {
    id: "xai" as const,
    title: "xAI voice & models",
    icon: Mic,
    blurb: "The realtime voice that answers calls and the text model that writes summaries.",
  },
  {
    id: "twilio" as const,
    title: "Twilio",
    icon: PhoneCall,
    blurb:
      "The auth token enables the phone bridge; adding the Account SID lets centers buy and wire up numbers from the Centers page.",
  },
  {
    id: "email" as const,
    title: "Email briefs (SMTP)",
    icon: Mail,
    blurb: "Where transfer-brief emails send from. Host + from address turn the feature on.",
  },
];

type Draft = Record<string, string | number | boolean | null>;

function sourceBadge(field: SettingsField) {
  if (field.source === "settings") return <Badge variant="success">Saved here</Badge>;
  if (field.source === "env") return <Badge variant="outline">From env</Badge>;
  return <Badge variant="muted">Default</Badge>;
}

export function SettingsPage() {
  const qc = useQueryClient();
  const { data: fields, isLoading } = useQuery(orpc.settings.get.queryOptions());

  // Only touched keys; secrets stay out until the admin types a new value.
  const [draft, setDraft] = useState<Draft>({});
  const dirty = Object.keys(draft).length > 0;

  const save = useMutation(
    orpc.settings.save.mutationOptions({
      onSuccess: (next) => {
        qc.setQueryData(orpc.settings.get.queryKey(), next);
        void qc.invalidateQueries({ queryKey: orpc.phone.config.key() });
        setDraft({});
        toast.success("Settings saved. They apply to the next call.");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const set = (key: string, value: string | number | boolean | null) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const unset = (key: string) =>
    setDraft((d) => {
      const { [key]: _, ...rest } = d;
      return rest;
    });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="mx-auto w-full max-w-4xl px-5 py-10 md:px-6">
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-none text-foreground">Settings</h1>
            <p className="text-[14px] text-muted-foreground">
              Keys, models, and email — stored in the database and applied live. Clearing a field
              falls back to the server's environment value.
            </p>
          </div>
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft)}
            className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
          >
            {save.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </Button>
        </header>

        {isLoading || !fields ? (
          <div className="mt-8 h-64 animate-pulse rounded-2xl border border-border/70 bg-card" />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
            className="mt-8 space-y-6"
          >
            {GROUPS.map((group) => (
              <section
                key={group.id}
                className="rounded-2xl border border-border/70 bg-card p-6 shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
              >
                <div className="flex items-center gap-2">
                  <group.icon className="size-4 text-brand" />
                  <h2 className="text-[15px] font-medium text-foreground">{group.title}</h2>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {group.blurb}
                </p>
                <div className="mt-5 space-y-5">
                  {fields
                    .filter((f) => f.group === group.id)
                    .map((f) => (
                      <FieldEditor
                        key={f.key}
                        field={f}
                        draft={draft[f.key]}
                        touched={f.key in draft}
                        onChange={(v) => set(f.key, v)}
                        onReset={() => unset(f.key)}
                        onClear={() => set(f.key, null)}
                      />
                    ))}
                </div>
              </section>
            ))}
          </motion.div>
        )}
      </div>
    </main>
  );
}

function FieldEditor({
  field,
  draft,
  touched,
  onChange,
  onReset,
  onClear,
}: {
  field: SettingsField;
  draft: string | number | boolean | null | undefined;
  touched: boolean;
  onChange: (v: string | number | boolean | null) => void;
  onReset: () => void;
  onClear: () => void;
}) {
  const clearing = touched && draft === null;
  const inputId = `setting-${field.key}`;

  const controls = () => {
    if (field.kind === "boolean") {
      const checked = touched && !clearing ? Boolean(draft) : Boolean(field.value);
      return (
        <Switch checked={checked} onCheckedChange={(v) => onChange(v)} aria-label={field.label} />
      );
    }
    if (field.kind === "select") {
      const options = field.options ?? [];
      const value = touched && !clearing ? String(draft) : String(field.value);
      return (
        <select
          id={inputId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full max-w-70 rounded-lg border border-border bg-card px-3 text-[13.5px] text-foreground"
        >
          {/* An env-configured value outside the list stays visible (and
              selectable back) but everything typeable is a known option. */}
          {value !== "" && !options.includes(value) && (
            <option value={value}>{value} (current)</option>
          )}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (field.kind === "number") {
      const value = touched && !clearing ? String(draft ?? "") : String(field.value || "");
      return (
        <Input
          id={inputId}
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="max-w-40"
        />
      );
    }
    // Text — secrets never echo their saved value.
    const value =
      touched && !clearing ? String(draft ?? "") : field.secret ? "" : String(field.value);
    return (
      <Input
        id={inputId}
        type={field.secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          field.secret ? (field.set ? "•••••••• (saved — type to replace)" : "Not set") : ""
        }
        autoComplete="off"
      />
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={inputId}>{field.label}</Label>
        <span className="flex items-center gap-1.5">
          {clearing && <Badge variant="muted">Will revert on save</Badge>}
          {sourceBadge(field)}
          {touched && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Undo ${field.label} change`}
              className="size-7 text-muted-foreground"
              onClick={onReset}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
          {!touched && field.source === "settings" && (
            <Button
              variant="ghost"
              className="h-7 px-2 text-[12px] text-muted-foreground"
              onClick={onClear}
            >
              Clear
            </Button>
          )}
        </span>
      </div>
      {controls()}
      {field.help && <p className="text-[12px] text-muted-foreground">{field.help}</p>}
    </div>
  );
}
