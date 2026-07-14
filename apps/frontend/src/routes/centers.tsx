import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Building2, Pencil, PhoneCall, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageShell } from "@/components/layout/PageShell";
import { useCenter } from "@/lib/center";
import { cardEntrance, rowEntrance } from "@/lib/motion";
import { orpc, type AvailableNumber, type Center } from "@/lib/orpc";
import { isE164 } from "@/lib/validate";
import { AGENT_NAME } from "@/lib/receptionist-agent";

const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Asia/Kolkata",
  "Europe/London",
];

/** Every IANA zone the browser knows, common ones first — a strict dropdown,
 *  so an unparseable zone can never be submitted. */
const ALL_TIMEZONES: string[] = (() => {
  try {
    const rest = Intl.supportedValuesOf("timeZone").filter((tz) => !COMMON_TIMEZONES.includes(tz));
    return [...COMMON_TIMEZONES, ...rest];
  } catch {
    return COMMON_TIMEZONES;
  }
})();

export function CentersPage() {
  const qc = useQueryClient();
  const { centers, setCenterId } = useCenter();
  const { data: config } = useQuery(orpc.phone.config.queryOptions());

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Center | null>(null);

  // Deep link: /centers?edit=<id> (from the Phone line page) opens that
  // center's editor as soon as the list is in.
  const search = useSearch({ strict: false }) as { edit?: string };
  useEffect(() => {
    if (!search.edit || editorOpen) return;
    const target = centers.find((c) => c.id === search.edit);
    if (target) {
      setEditing(target);
      setEditorOpen(true);
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [search.edit, centers]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: orpc.centers.list.key() });
    void qc.invalidateQueries({ queryKey: orpc.phone.numbers.list.key() });
    void qc.invalidateQueries({ queryKey: orpc.prompt.get.key() });
  };

  const remove = useMutation(
    orpc.centers.remove.mutationOptions({
      onSuccess: () => {
        invalidate();
        toast.success("Center deleted.");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (row: Center) => {
    setEditing(row);
    setEditorOpen(true);
  };

  return (
    <PageShell
      title="Centers"
      subtitle={`Every location ${AGENT_NAME} answers for. Each center has its own phone number, staff roster, prompt, and timezone.`}
      action={
        <Button onClick={openCreate} variant="brand">
          <Plus className="size-4" /> Add center
        </Button>
      }
    >
      <motion.div
        {...cardEntrance}
        className="mt-8 rounded-2xl border border-border/70 bg-card shadow-card"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Center</TableHead>
              <TableHead>Timezone</TableHead>
              <TableHead>Phone line</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {centers.map((row, i) => (
              <motion.tr
                key={row.id}
                {...rowEntrance(i)}
                className="border-b border-border/50 last:border-0"
              >
                <TableCell className="pl-5">
                  <button
                    type="button"
                    onClick={() => setCenterId(row.id)}
                    className="flex items-center gap-2 text-[14px] font-medium text-foreground pf-hover:text-brand"
                    title="Make this the selected center"
                  >
                    <Building2 className="size-4 text-brand" /> {row.name}
                  </button>
                </TableCell>
                <TableCell>
                  <span className="text-[12.5px] text-muted-foreground">{row.timezone}</span>
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    title="Configure this center's number"
                    className="tap text-left"
                  >
                    {row.phoneNumber ? (
                      <span className="whitespace-nowrap text-[12.5px] tabular-nums text-foreground pf-hover:text-brand">
                        {row.phoneNumber}
                      </span>
                    ) : (
                      <span className="text-[12px] text-brand underline-offset-2 pf-hover:underline">
                        Set up number
                      </span>
                    )}
                  </button>
                </TableCell>
                <TableCell>
                  {row.active ? (
                    <Badge variant="success">Active</Badge>
                  ) : (
                    <Badge variant="muted">Inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="pr-5">
                  <span className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${row.name}`}
                      className="size-8 text-muted-foreground"
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${row.name}`}
                      className="size-8 text-muted-foreground"
                      disabled={centers.length <= 1}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${row.name}? Its staff assignments and prompt go with it; the call history is kept.`,
                          )
                        ) {
                          remove.mutate({ id: row.id });
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </span>
                </TableCell>
              </motion.tr>
            ))}
          </TableBody>
        </Table>
      </motion.div>

      <CenterEditor
        key={editing?.id ?? "new"}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        numbersEnabled={config?.twilio.numbersEnabled ?? false}
        onSaved={invalidate}
      />
    </PageShell>
  );
}

function CenterEditor({
  open,
  onOpenChange,
  editing,
  numbersEnabled,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Center | null;
  numbersEnabled: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [timezone, setTimezone] = useState(editing?.timezone ?? "America/Chicago");
  const [active, setActive] = useState(editing?.active ?? true);
  const [phoneNumber, setPhoneNumber] = useState(editing?.phoneNumber ?? "");
  const [fallbackNumber, setFallbackNumber] = useState(editing?.fallbackNumber ?? "");
  const [ahEnabled, setAhEnabled] = useState(editing?.afterHoursEnabled ?? false);
  const [ahStart, setAhStart] = useState(editing?.afterHoursStart ?? "16:30");
  const [ahEnd, setAhEnd] = useState(editing?.afterHoursEnd ?? "08:00");
  const [ahGreeting, setAhGreeting] = useState(editing?.afterHoursGreeting ?? "");
  const [ambienceEnabled, setAmbienceEnabled] = useState(editing?.ambienceEnabled ?? false);
  const [ambienceLevel, setAmbienceLevel] = useState(editing?.ambienceLevel ?? 8);

  const afterHoursFields = {
    fallbackNumber: fallbackNumber.trim(),
    afterHoursEnabled: ahEnabled,
    afterHoursStart: ahStart,
    afterHoursEnd: ahEnd,
    afterHoursGreeting: ahGreeting.trim(),
    ambienceEnabled,
    ambienceLevel,
  };
  // Creating only: the line picked in the one-step flow (attach or buy).
  const [line, setLine] = useState<{ attachSid?: string; buyNumber?: string } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      editing
        ? orpc.centers.update.call({
            id: editing.id,
            data: {
              name: name.trim(),
              timezone: timezone.trim(),
              active,
              ...afterHoursFields,
              // Only send the number when it was hand-edited, so app-managed
              // Twilio numbers (buy/attach) keep their stored SID.
              ...(phoneNumber.trim() === editing.phoneNumber
                ? {}
                : { phoneNumber: phoneNumber.trim() }),
            },
          })
        : orpc.centers.create.call({
            name: name.trim(),
            timezone: timezone.trim(),
            ...afterHoursFields,
            ...(line?.attachSid ? { attachSid: line.attachSid } : {}),
            ...(line?.buyNumber ? { buyNumber: line.buyNumber } : {}),
            ...(!line && phoneNumber.trim() ? { phoneNumber: phoneNumber.trim() } : {}),
          }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      toast.success(
        editing
          ? "Center updated."
          : line
            ? "Center created with its number wired up. Switch to it and add staff."
            : "Center created. Add its staff and number when ready.",
      );
    },
    onError: (e) => toast.error(e.message),
  });

  const valid =
    name.trim() !== "" && timezone.trim() !== "" && isE164(phoneNumber) && isE164(fallbackNumber);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-xl">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${editing.name}` : "Add a center"}</SheetTitle>
          <SheetDescription>
            {editing
              ? "The name feeds the default prompt; schedules evaluate in the timezone."
              : "Create the center first, then configure its phone line and roster."}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="center-name">Name</Label>
            <Input
              id="center-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Pine Lodge Assisted Living"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="center-tz">Timezone</Label>
            <Select id="center-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {!ALL_TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {ALL_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
            <p className="text-[12px] text-muted-foreground">
              Staff schedules and availability at this center evaluate in this timezone.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="center-fallback">Default transfer number (E.164)</Label>
            <Input
              id="center-fallback"
              value={fallbackNumber}
              onChange={(e) => setFallbackNumber(e.target.value)}
              placeholder="+19035008221"
            />
            <p className="text-[12px] text-muted-foreground">
              Always-reachable last resort. When no staff member is on shift to take a call, Sarah
              connects the caller to this number instead of dropping them. Leave empty to have her
              take a message.
            </p>
          </div>

          <div className="space-y-4 rounded-xl border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">After-hours messages</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Past the cutoff, callers hear that staff has left for the day and Sarah only takes
                  a message — reviewed on the Messages page each morning.
                </p>
              </div>
              <Switch
                checked={ahEnabled}
                onCheckedChange={setAhEnabled}
                aria-label="After-hours messages"
              />
            </div>
            {ahEnabled && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="center-ah-start">Starts</Label>
                    <Input
                      id="center-ah-start"
                      type="time"
                      value={ahStart}
                      onChange={(e) => setAhStart(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="center-ah-end">Ends (next morning)</Label>
                    <Input
                      id="center-ah-end"
                      type="time"
                      value={ahEnd}
                      onChange={(e) => setAhEnd(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="center-ah-greeting">After-hours greeting</Label>
                  <Textarea
                    id="center-ah-greeting"
                    rows={3}
                    value={ahGreeting}
                    onChange={(e) => setAhGreeting(e.target.value)}
                    placeholder={`Thank you for calling ${name.trim() || "the center"}, this is Sarah. Our staff has left for the day and will reach out first thing tomorrow morning — may I take a message?`}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Spoken verbatim when a call comes in after hours. Leave empty for the default.
                  </p>
                </div>
              </>
            )}
          </div>

          <div className="space-y-4 rounded-xl border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Front-desk ambience</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Keeps a soft room tone on the line for the whole call — under Sarah's voice and
                  through the pauses — like a real front desk on an open mic. Audio only, never
                  changes how calls or transfers work.
                </p>
              </div>
              <Switch
                checked={ambienceEnabled}
                onCheckedChange={setAmbienceEnabled}
                aria-label="Front-desk ambience"
              />
            </div>
            {ambienceEnabled && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="center-ambience-level">Level</Label>
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {ambienceLevel}%
                  </span>
                </div>
                <input
                  id="center-ambience-level"
                  aria-label="Ambience level"
                  type="range"
                  min={1}
                  max={25}
                  step={1}
                  value={ambienceLevel}
                  onChange={(e) => setAmbienceLevel(Number(e.target.value))}
                  className="w-full accent-brand"
                />
                <p className="text-[12px] text-muted-foreground">
                  Keep it subtle — around 8% it reads as a quiet, staffed office rather than noise.
                </p>
              </div>
            )}
          </div>

          {!editing && (
            <div className="space-y-4 rounded-xl border border-brand/25 bg-background p-4">
              <div className="flex items-center gap-2">
                <PhoneCall className="size-4 text-brand" />
                <p className="text-[13.5px] font-medium text-foreground">
                  Phone line <span className="font-normal text-muted-foreground">(optional)</span>
                </p>
              </div>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Give the center its number now and it answers calls the moment it's created — the
                voice webhook is wired up automatically. You can also do this later from the
                center's editor.
              </p>
              {numbersEnabled ? (
                <LinePicker line={line} onPick={setLine} />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="center-phone-create">Number (E.164)</Label>
                  <Input
                    id="center-phone-create"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="+19547023000"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    For numbers wired up in the Twilio console by hand. Add the Twilio Account SID
                    in Settings to search and buy numbers from here instead.
                  </p>
                </div>
              )}
            </div>
          )}

          {editing && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background p-4">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Active</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Inactive centers stay in the dropdown but are flagged.
                </p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} aria-label="Active" />
            </div>
          )}

          {editing && (
            <div className="space-y-4 rounded-xl border border-brand/25 bg-background p-4">
              <div className="flex items-center gap-2">
                <PhoneCall className="size-4 text-brand" />
                <p className="text-[13.5px] font-medium text-foreground">Phone line</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="center-phone">Number (E.164)</Label>
                <Input
                  id="center-phone"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+19547023000"
                />
                <p className="text-[12px] text-muted-foreground">
                  Calls to this number reach this center's receptionist. Type it here if the number
                  is wired up in the Twilio console by hand
                  {numbersEnabled ? ", or manage it below" : ""}. Clear it to detach.
                </p>
              </div>

              {numbersEnabled ? (
                <NumberManager center={editing} onChanged={onSaved} />
              ) : (
                <p className="rounded-lg bg-secondary/50 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
                  Add the Twilio Account SID and Auth Token in Settings to search, buy, and wire up
                  numbers from here.
                </p>
              )}
            </div>
          )}
        </SheetBody>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()} variant="brand">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

const fail = (e: Error) => toast.error(e.message);

/** Pick a line while creating a center: an unassigned owned number, or a
 *  catalog number to buy. Nothing touches Twilio until the center saves. */
function NumberRow({
  primary,
  secondary,
  action,
}: {
  primary: string;
  secondary: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2">
      <span className="min-w-0">
        <span className="block text-[13px] tabular-nums text-foreground">{primary}</span>
        <span className="block truncate text-[11.5px] text-muted-foreground">{secondary}</span>
      </span>
      {action}
    </div>
  );
}

function NumberSearch({
  id,
  note,
  action,
}: {
  id: string;
  note: string;
  action: (n: AvailableNumber, clear: () => void) => React.ReactNode;
}) {
  const [areaCode, setAreaCode] = useState("");
  const [results, setResults] = useState<AvailableNumber[]>([]);
  const search = useMutation({
    mutationFn: () =>
      orpc.phone.numbers.search.call({
        country: "US",
        ...(areaCode.trim() ? { areaCode: areaCode.trim() } : {}),
      }),
    onSuccess: setResults,
    onError: fail,
  });
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Buy a new number</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={areaCode}
          onChange={(e) => setAreaCode(e.target.value)}
          placeholder="Area code, e.g. 954"
          className="max-w-45"
        />
        <Button
          variant="outline"
          disabled={search.isPending}
          onClick={() => search.mutate()}
          aria-label="Search numbers"
        >
          <Search className="size-3.5" /> {search.isPending ? "Searching…" : "Search"}
        </Button>
      </div>
      {results.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {results.slice(0, 8).map((n) => (
            <NumberRow
              key={n.phoneNumber}
              primary={n.friendlyName || n.phoneNumber}
              secondary={[n.locality, n.region].filter(Boolean).join(", ") || "US"}
              action={action(n, () => setResults([]))}
            />
          ))}
          <p className="text-[11.5px] text-muted-foreground">{note}</p>
        </div>
      )}
    </div>
  );
}

function LinePicker({
  line,
  onPick,
}: {
  line: { attachSid?: string; buyNumber?: string } | null;
  onPick: (line: { attachSid?: string; buyNumber?: string } | null) => void;
}) {
  const { data: owned } = useQuery(orpc.phone.numbers.list.queryOptions());
  const unassigned = (owned ?? []).filter((n) => n.center === null);

  if (line) {
    const label = line.buyNumber ?? unassigned.find((n) => n.sid === line.attachSid)?.phoneNumber;
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-brand/40 bg-brand-soft/40 px-3 py-2">
        <span className="text-[13px] text-foreground">
          {line.buyNumber ? "Will buy " : "Will use "}
          <span className="tabular-nums">{label ?? "selected number"}</span>
          {" and point its webhook here."}
        </span>
        <Button variant="ghost" size="sm" onClick={() => onPick(null)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {unassigned.length > 0 && (
        <div className="space-y-1.5">
          <Label>Numbers already on the Twilio account</Label>
          <div className="space-y-1.5">
            {unassigned.map((n) => (
              <NumberRow
                key={n.sid}
                primary={n.phoneNumber}
                secondary={n.friendlyName || "unnamed"}
                action={
                  <Button variant="outline" size="sm" onClick={() => onPick({ attachSid: n.sid })}>
                    Use this number
                  </Button>
                }
              />
            ))}
          </div>
        </div>
      )}

      <NumberSearch
        id="create-number-area"
        note="The purchase happens when the center saves; it charges the Twilio account."
        // oxlint-disable-next-line react/no-unstable-nested-components
        action={(n) => (
          <Button size="sm" onClick={() => onPick({ buyNumber: n.phoneNumber })} variant="brand">
            Choose
          </Button>
        )}
      />
    </div>
  );
}

/** Twilio number controls for one center: assign an owned number, search and
 *  buy a new one, keep the webhook pointed here, or let the number go. */
function NumberManager({ center, onChanged }: { center: Center; onChanged: () => void }) {
  const qc = useQueryClient();
  const { data: owned } = useQuery(orpc.phone.numbers.list.queryOptions());
  const unassigned = (owned ?? []).filter((n) => !n.center || n.center.id === center.id);

  const done = (message: string) => {
    onChanged();
    void qc.invalidateQueries({ queryKey: orpc.centers.list.key() });
    void qc.invalidateQueries({ queryKey: orpc.phone.numbers.list.key() });
    toast.success(message);
  };

  const buy = useMutation({
    mutationFn: (num: string) =>
      orpc.phone.numbers.buy.call({ centerId: center.id, phoneNumber: num }),
    onSuccess: () => done("Number bought and wired up. Calls to it now reach this center."),
    onError: fail,
  });
  const attach = useMutation({
    mutationFn: (sid: string) => orpc.phone.numbers.attach.call({ centerId: center.id, sid }),
    onSuccess: () => done("Number attached. Its webhook now points here."),
    onError: fail,
  });
  const detach = useMutation({
    mutationFn: () => orpc.phone.numbers.detach.call({ centerId: center.id }),
    onSuccess: () => done("Number detached from this center (still owned on Twilio)."),
    onError: fail,
  });
  const release = useMutation({
    mutationFn: () => orpc.phone.numbers.release.call({ centerId: center.id }),
    onSuccess: () => done("Number released back to Twilio."),
    onError: fail,
  });
  const sync = useMutation({
    mutationFn: () => orpc.phone.numbers.syncWebhook.call({ centerId: center.id }),
    onSuccess: () => toast.success("Voice webhook re-pointed at this deployment."),
    onError: fail,
  });

  const busy =
    buy.isPending || attach.isPending || detach.isPending || release.isPending || sync.isPending;

  return (
    <div className="space-y-4 border-t border-border/60 pt-4">
      {center.phoneNumber !== "" && (
        <div className="flex flex-wrap items-center gap-2">
          {center.twilioNumberSid !== "" && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => sync.mutate()}>
              <RefreshCw className="size-3.5" /> Re-sync webhook
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => detach.mutate()}>
            Detach
          </Button>
          {center.twilioNumberSid !== "" && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              className="text-destructive"
              onClick={() => {
                if (
                  window.confirm(
                    `Release ${center.phoneNumber}? Twilio stops billing for it and it stops ringing — this cannot be undone.`,
                  )
                ) {
                  release.mutate();
                }
              }}
            >
              Release number
            </Button>
          )}
        </div>
      )}

      {unassigned.some((n) => n.center === null) && (
        <div className="space-y-1.5">
          <Label>Numbers already on the Twilio account</Label>
          <div className="space-y-1.5">
            {unassigned
              .filter((n) => n.center === null)
              .map((n) => (
                <NumberRow
                  key={n.sid}
                  primary={n.phoneNumber}
                  secondary={n.friendlyName || "unnamed"}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => attach.mutate(n.sid)}
                    >
                      Use for this center
                    </Button>
                  }
                />
              ))}
          </div>
        </div>
      )}

      <NumberSearch
        id="number-area"
        note="Buying charges the Twilio account and points the number's voice webhook at this deployment automatically."
        // oxlint-disable-next-line react/no-unstable-nested-components
        action={(n, clear) => (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              buy.mutate(n.phoneNumber);
              clear();
            }}
            variant="brand"
          >
            {buy.isPending ? "Buying…" : "Buy"}
          </Button>
        )}
      />
    </div>
  );
}
