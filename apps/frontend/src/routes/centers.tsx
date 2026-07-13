import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCenter } from "@/lib/center";
import { orpc, type AvailableNumber, type Center } from "@/lib/orpc";
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
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="w-full px-5 py-10 md:px-8">
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-none text-foreground">Centers</h1>
            <p className="text-[14px] text-muted-foreground">
              Every location {AGENT_NAME} answers for. Each center has its own phone number, staff
              roster, prompt, and timezone.
            </p>
          </div>
          <Button
            onClick={openCreate}
            className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
          >
            <Plus className="size-4" /> Add center
          </Button>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
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
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: i * 0.04, ease: [0.23, 1, 0.32, 1] }}
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
                    {row.phoneNumber ? (
                      <span className="whitespace-nowrap text-[12.5px] tabular-nums text-foreground">
                        {row.phoneNumber}
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground/60">not set</span>
                    )}
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
      </div>

      <CenterEditor
        key={editing?.id ?? "new"}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        numbersEnabled={config?.twilio.numbersEnabled ?? false}
        onSaved={invalidate}
      />
    </main>
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

  const phoneOk = phoneNumber.trim() === "" || /^\+[1-9]\d{6,14}$/.test(phoneNumber.trim());
  const valid = name.trim() !== "" && timezone.trim() !== "" && phoneOk;

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
          <Button
            disabled={!valid || save.isPending}
            onClick={() => save.mutate()}
            className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
          >
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
function LinePicker({
  line,
  onPick,
}: {
  line: { attachSid?: string; buyNumber?: string } | null;
  onPick: (line: { attachSid?: string; buyNumber?: string } | null) => void;
}) {
  const { data: owned } = useQuery(orpc.phone.numbers.list.queryOptions());
  const unassigned = (owned ?? []).filter((n) => n.center === null);
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
              <div
                key={n.sid}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] tabular-nums text-foreground">
                    {n.phoneNumber}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {n.friendlyName || "unnamed"}
                  </span>
                </span>
                <Button variant="outline" size="sm" onClick={() => onPick({ attachSid: n.sid })}>
                  Use this number
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="create-number-area">Buy a new number</Label>
        <div className="flex items-center gap-2">
          <Input
            id="create-number-area"
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
              <div
                key={n.phoneNumber}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] tabular-nums text-foreground">
                    {n.friendlyName || n.phoneNumber}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {[n.locality, n.region].filter(Boolean).join(", ") || "US"}
                  </span>
                </span>
                <Button
                  size="sm"
                  onClick={() => onPick({ buyNumber: n.phoneNumber })}
                  className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
                >
                  Choose
                </Button>
              </div>
            ))}
            <p className="text-[11.5px] text-muted-foreground">
              The purchase happens when the center saves; it charges the Twilio account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Twilio number controls for one center: assign an owned number, search and
 *  buy a new one, keep the webhook pointed here, or let the number go. */
function NumberManager({ center, onChanged }: { center: Center; onChanged: () => void }) {
  const qc = useQueryClient();
  const [areaCode, setAreaCode] = useState("");
  const [results, setResults] = useState<AvailableNumber[]>([]);

  const { data: owned } = useQuery(orpc.phone.numbers.list.queryOptions());
  const unassigned = (owned ?? []).filter((n) => !n.center || n.center.id === center.id);

  const done = (message: string) => {
    onChanged();
    void qc.invalidateQueries({ queryKey: orpc.centers.list.key() });
    void qc.invalidateQueries({ queryKey: orpc.phone.numbers.list.key() });
    toast.success(message);
  };

  const search = useMutation({
    mutationFn: () =>
      orpc.phone.numbers.search.call({
        country: "US",
        ...(areaCode.trim() ? { areaCode: areaCode.trim() } : {}),
      }),
    onSuccess: setResults,
    onError: fail,
  });
  const buy = useMutation({
    mutationFn: (num: string) =>
      orpc.phone.numbers.buy.call({ centerId: center.id, phoneNumber: num }),
    onSuccess: () => {
      setResults([]);
      done("Number bought and wired up. Calls to it now reach this center.");
    },
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
                <div
                  key={n.sid}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] tabular-nums text-foreground">
                      {n.phoneNumber}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {n.friendlyName || "unnamed"}
                    </span>
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => attach.mutate(n.sid)}
                  >
                    Use for this center
                  </Button>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="number-area">Buy a new number</Label>
        <div className="flex items-center gap-2">
          <Input
            id="number-area"
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
              <div
                key={n.phoneNumber}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] tabular-nums text-foreground">
                    {n.friendlyName || n.phoneNumber}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {[n.locality, n.region].filter(Boolean).join(", ") || "US"}
                  </span>
                </span>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => buy.mutate(n.phoneNumber)}
                  className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
                >
                  {buy.isPending ? "Buying…" : "Buy"}
                </Button>
              </div>
            ))}
            <p className="text-[11.5px] text-muted-foreground">
              Buying charges the Twilio account and points the number's voice webhook at this
              deployment automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
