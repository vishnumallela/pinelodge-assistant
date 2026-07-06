import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { motion } from "framer-motion";
import { CalendarDays, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import {
  createStaff,
  deleteStaff,
  listStaff,
  updateStaff,
  type StaffInput,
  type StaffMember,
} from "@/lib/staff-api";
import { AGENT_NAME } from "@/lib/receptionist-agent";
import { cn } from "@/lib/utils";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleLabel(s: StaffMember): string {
  const days =
    s.days.length === 7
      ? "Every day"
      : s.days
          .toSorted((a, b) => a - b)
          .map((d) => DAY_NAMES[d])
          .join(" ");
  return `${days} · ${s.startTime}–${s.endTime}`;
}

interface StaffTableMeta {
  onEdit: (row: StaffMember) => void;
  onRemove: (row: StaffMember) => void;
}

const helper = createColumnHelper<StaffMember>();

// Module scope: stable cell components; actions reach the page via table.meta.
const columns = [
  helper.accessor("name", {
    header: "Name",
    cell: (info) => (
      <span className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
        {info.getValue()}
        {info.row.original.isFallback && (
          <Star className="size-3.5 fill-brand text-brand" aria-label="Fallback destination" />
        )}
      </span>
    ),
  }),
  helper.accessor("section", {
    header: "Section",
    cell: (info) => <span className="text-[13.5px] text-foreground">{info.getValue()}</span>,
  }),
  helper.accessor("handles", {
    header: "Handles",
    cell: (info) => (
      <span className="block max-w-[220px] truncate text-[13px] text-muted-foreground">
        {info.getValue() || "—"}
      </span>
    ),
  }),
  helper.accessor("phone", {
    header: "Line",
    cell: (info) =>
      info.getValue() ? (
        <span className="whitespace-nowrap text-[12.5px] tabular-nums text-muted-foreground">
          {info.getValue()}
        </span>
      ) : (
        <span className="text-[12px] text-muted-foreground/60">announce only</span>
      ),
  }),
  helper.display({
    id: "schedule",
    header: "Schedule",
    cell: ({ row }) => (
      <span className="text-[12.5px] tabular-nums text-muted-foreground">
        {scheduleLabel(row.original)}
        {row.original.timeOff.length > 0 && (
          <span className="ml-1.5 text-muted-foreground/70">
            · {row.original.timeOff.length} day{row.original.timeOff.length > 1 ? "s" : ""} off
          </span>
        )}
      </span>
    ),
  }),
  helper.display({
    id: "status",
    header: "Now",
    cell: ({ row }) =>
      !row.original.active ? (
        <Badge variant="muted">Inactive</Badge>
      ) : row.original.availableNow ? (
        <Badge variant="success">Available</Badge>
      ) : (
        <Badge variant="outline">Off shift</Badge>
      ),
  }),
  helper.display({
    id: "actions",
    header: "",
    cell: ({ row, table }) => {
      const meta = table.options.meta as StaffTableMeta;
      return (
        <span className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit ${row.original.name}`}
            className="size-8 text-muted-foreground"
            onClick={() => meta.onEdit(row.original)}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove ${row.original.name}`}
            className="size-8 text-muted-foreground"
            onClick={() => meta.onRemove(row.original)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      );
    },
  }),
];

const EMPTY_FORM: StaffInput = {
  name: "",
  section: "",
  handles: "",
  phone: "",
  days: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "17:00",
  timeOff: [],
  isFallback: false,
  active: true,
};

export function StaffPage() {
  const qc = useQueryClient();
  const { data: staff, isLoading } = useQuery({
    queryKey: ["staff"],
    queryFn: listStaff,
    refetchOnWindowFocus: true,
  });

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["staff"] });
    void qc.invalidateQueries({ queryKey: ["agent-prompt"] });
  };

  const remove = useMutation({
    mutationFn: deleteStaff,
    onSuccess: () => {
      invalidate();
      toast.success("Staff member removed.");
    },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (row: StaffMember) => {
    setEditing(row);
    setEditorOpen(true);
  };

  const meta = useMemo<StaffTableMeta>(
    () => ({
      onEdit: openEdit,
      onRemove: (row) => {
        if (row.isFallback) {
          toast.error("Assign another fallback before removing this person.");
          return;
        }
        remove.mutate(row.id);
      },
    }),
    // openEdit/remove are stable enough for the table's lifetime here.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const table = useReactTable({
    data: staff ?? [],
    columns,
    meta,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className="mx-auto w-full max-w-4xl px-5 py-10 md:px-6">
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-none text-foreground">Staff</h1>
            <p className="text-[14px] text-muted-foreground">
              Who {AGENT_NAME} can redirect callers to, and when they're reachable. The starred
              person catches everything else.
            </p>
          </div>
          <Button
            onClick={openCreate}
            className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
          >
            <Plus className="size-4" /> Add person
          </Button>
        </header>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className="mt-8 rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(33,28,24,0.04)]"
        >
          {isLoading ? (
            <div className="h-64 animate-pulse" />
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id} className="first:pl-5 last:pr-5">
                        {h.isPlaceholder
                          ? null
                          : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row, i) => (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: i * 0.04, ease: [0.23, 1, 0.32, 1] }}
                    className="border-b border-border/50 last:border-0"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="first:pl-5 last:pr-5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </motion.tr>
                ))}
              </TableBody>
            </Table>
          )}
        </motion.div>
      </div>

      <StaffEditor
        key={editing?.id ?? "new"}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        onSaved={invalidate}
      />
    </main>
  );
}

function StaffEditor({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: StaffMember | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<StaffInput>(
    editing
      ? {
          name: editing.name,
          section: editing.section,
          handles: editing.handles,
          phone: editing.phone,
          days: editing.days,
          startTime: editing.startTime,
          endTime: editing.endTime,
          timeOff: editing.timeOff,
          isFallback: editing.isFallback,
          active: editing.active,
        }
      : EMPTY_FORM,
  );

  const set = <K extends keyof StaffInput>(key: K, value: StaffInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleDay = (d: number) =>
    set(
      "days",
      form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].toSorted(),
    );

  const timeOffDates = form.timeOff.map((d) => new Date(`${d}T12:00:00`));

  const save = useMutation({
    mutationFn: () => (editing ? updateStaff(editing.id, form) : createStaff(form)),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      toast.success(editing ? "Schedule updated." : "Staff member added.");
    },
    onError: (e) => toast.error(e.message),
  });

  const phoneOk = form.phone.trim() === "" || /^\+[1-9]\d{6,14}$/.test(form.phone.trim());
  const valid =
    form.name.trim() !== "" && form.section.trim() !== "" && form.days.length > 0 && phoneOk;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${editing.name}` : "Add a person"}</SheetTitle>
          <SheetDescription>
            Availability is evaluated in facility time. Calls outside these windows go to the
            fallback.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff-name">Name</Label>
              <Input
                id="staff-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-section">Section</Label>
              <Input
                id="staff-section"
                value={form.section}
                onChange={(e) => set("section", e.target.value)}
                placeholder="Billing"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="staff-handles">Handles</Label>
            <Input
              id="staff-handles"
              value={form.handles}
              onChange={(e) => set("handles", e.target.value)}
              placeholder="invoices, insurance, Medicaid"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="staff-phone">Phone (E.164)</Label>
            <Input
              id="staff-phone"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+19547023000"
            />
            <p className="text-[12px] text-muted-foreground">
              Calls transfer to this line. Leave empty to only announce the redirect.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Working days</Label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((label, d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={form.days.includes(d)}
                  aria-label={DAY_NAMES[d]}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "tap grid size-9 place-items-center rounded-lg border text-[13px] font-medium transition-colors",
                    form.days.includes(d)
                      ? "border-brand bg-brand-soft text-brand"
                      : "border-border bg-card text-muted-foreground pf-hover:bg-accent",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="staff-start">Shift start</Label>
              <Input
                id="staff-start"
                type="time"
                value={form.startTime}
                onChange={(e) => set("startTime", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staff-end">Shift end</Label>
              <Input
                id="staff-end"
                type="time"
                value={form.endTime}
                onChange={(e) => set("endTime", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Time off</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start gap-2 font-normal">
                  <CalendarDays className="size-4 text-muted-foreground" />
                  {form.timeOff.length === 0
                    ? "Pick dates off"
                    : `${form.timeOff.length} date${form.timeOff.length > 1 ? "s" : ""} off`}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto">
                <Calendar
                  mode="multiple"
                  selected={timeOffDates}
                  onSelect={(dates) =>
                    set(
                      "timeOff",
                      (dates ?? []).map((d) => {
                        const y = d.getFullYear();
                        const m = String(d.getMonth() + 1).padStart(2, "0");
                        const day = String(d.getDate()).padStart(2, "0");
                        return `${y}-${m}-${day}`;
                      }),
                    )
                  }
                />
              </PopoverContent>
            </Popover>
            {form.timeOff.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {form.timeOff.toSorted().map((d) => (
                  <Badge key={d} variant="muted" className="tabular-nums">
                    {d}
                    <button
                      type="button"
                      aria-label={`Remove ${d}`}
                      className="ml-0.5 text-muted-foreground/70 pf-hover:text-foreground"
                      onClick={() =>
                        set(
                          "timeOff",
                          form.timeOff.filter((x) => x !== d),
                        )
                      }
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4 rounded-xl border border-border/70 bg-background p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Fallback destination</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Unplaceable and after-hours calls come here. Exactly one person holds this.
                </p>
              </div>
              <Switch
                checked={form.isFallback}
                onCheckedChange={(v) => set("isFallback", v)}
                aria-label="Fallback destination"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[13.5px] font-medium text-foreground">Active</p>
                <p className="text-[12.5px] text-muted-foreground">
                  Inactive staff never appear in {AGENT_NAME}'s directory.
                </p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => set("active", v)}
                aria-label="Active"
              />
            </div>
          </div>
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
