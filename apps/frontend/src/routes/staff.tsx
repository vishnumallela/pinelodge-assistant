import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc, orpcClient } from "@/lib/orpc";
import { Page } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Staff = Awaited<ReturnType<typeof orpcClient.staff.list>>[number];

const DAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;
type DayKey = (typeof DAYS)[number][0];

interface FormState {
  name: string;
  role: string;
  department: string;
  extension: string;
  workingDays: DayKey[];
  shiftStart: string;
  shiftEnd: string;
  active: boolean;
  fallbackDestination: string;
}

const EMPTY: FormState = {
  name: "",
  role: "",
  department: "",
  extension: "",
  workingDays: ["mon", "tue", "wed", "thu", "fri"],
  shiftStart: "08:00",
  shiftEnd: "17:00",
  active: true,
  fallbackDestination: "voicemail",
};

function toForm(s: Staff): FormState {
  return {
    name: s.name,
    role: s.role,
    department: s.department,
    extension: s.extension,
    workingDays: s.workingDays as DayKey[],
    shiftStart: s.shiftStart,
    shiftEnd: s.shiftEnd,
    active: s.active,
    fallbackDestination: s.fallbackDestination,
  };
}

export function StaffPage() {
  const qc = useQueryClient();
  const { data: staff = [], isPending } = useQuery(orpc.staff.list.queryOptions());
  // null = nothing selected; "new" = creating; otherwise a staff id.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: orpc.staff.list.key() });
    void qc.invalidateQueries({ queryKey: orpc.availability.key() });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (selectedId && selectedId !== "new") {
        return orpcClient.staff.update({ id: selectedId, patch: form });
      }
      return orpcClient.staff.create(form);
    },
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      toast.success("Saved. Routing uses the new schedule immediately.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => orpcClient.staff.remove({ id }),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      toast.success("Staff member removed.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not remove."),
  });

  const open = (s: Staff) => {
    setSelectedId(s.id);
    setForm(toForm(s));
  };
  const openNew = () => {
    setSelectedId("new");
    setForm(EMPTY);
  };

  const editing = selectedId !== null;
  const canSave =
    form.name.trim() !== "" &&
    form.role.trim() !== "" &&
    form.department.trim() !== "" &&
    form.extension.trim() !== "" &&
    form.workingDays.length > 0;

  return (
    <Page
      title="Staff"
      description="Who calls can be routed to. Shift times are facility local (Central Time); changes apply to the next call."
    >
      <div className="flex flex-col gap-8">
        {isPending ? (
          <div className="flex flex-col gap-3 pt-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="hidden md:table-cell">Ext.</TableHead>
                <TableHead className="hidden md:table-cell">Shift</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((s) => (
                <TableRow key={s.id} className="relative cursor-pointer">
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      onClick={() => open(s)}
                      className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {s.name}
                    </button>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {s.role}
                  </TableCell>
                  <TableCell>{s.department}</TableCell>
                  <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
                    {s.extension}
                  </TableCell>
                  <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
                    {s.shiftStart}–{s.shiftEnd}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {s.active ? "Active" : "Inactive"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!editing && (
          <div>
            <Button variant="outline" onClick={openNew}>
              Add staff member
            </Button>
          </div>
        )}

        {editing && (
          <form
            className="flex max-w-xl flex-col gap-5 border-t border-border pt-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate();
            }}
          >
            <h2 className="text-sm font-semibold tracking-tight">
              {selectedId === "new" ? "New staff member" : `Edit ${form.name || "staff member"}`}
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="staff-name">
                <Input
                  id="staff-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Role" htmlFor="staff-role">
                <Input
                  id="staff-role"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                />
              </Field>
              <Field label="Department" htmlFor="staff-department">
                <Input
                  id="staff-department"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="Admissions, Billing, Administration, Front Office, Nursing"
                />
              </Field>
              <Field label="Extension" htmlFor="staff-extension">
                <Input
                  id="staff-extension"
                  value={form.extension}
                  onChange={(e) => setForm({ ...form, extension: e.target.value })}
                />
              </Field>
              <Field label="Shift start" htmlFor="staff-shift-start">
                <Input
                  id="staff-shift-start"
                  type="time"
                  value={form.shiftStart}
                  onChange={(e) => setForm({ ...form, shiftStart: e.target.value })}
                />
              </Field>
              <Field label="Shift end" htmlFor="staff-shift-end">
                <Input
                  id="staff-shift-end"
                  type="time"
                  value={form.shiftEnd}
                  onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Working days</Label>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map(([key, label]) => {
                  const on = form.workingDays.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setForm({
                          ...form,
                          workingDays: on
                            ? form.workingDays.filter((d) => d !== key)
                            : [...form.workingDays, key],
                        })
                      }
                      className={cn(
                        "h-8 rounded-full border px-3.5 text-xs font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        on
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground pf-hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label>When off shift, send calls to</Label>
                <Select
                  value={form.fallbackDestination}
                  onValueChange={(v) => setForm({ ...form, fallbackDestination: v })}
                >
                  <SelectTrigger aria-label="Fallback destination" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="voicemail">Voicemail</SelectItem>
                    <SelectItem value="nursing">Nursing line</SelectItem>
                    {staff
                      .filter((s) => s.id !== selectedId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="staff-active">Status</Label>
                <div className="flex h-9 items-center gap-2.5">
                  <Switch
                    id="staff-active"
                    checked={form.active}
                    onCheckedChange={(v) => setForm({ ...form, active: v })}
                  />
                  <span className="text-sm">
                    {form.active ? "Active — can receive calls" : "Inactive"}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" disabled={!canSave || save.isPending}>
                {selectedId === "new" ? "Create" : "Save changes"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelectedId(null)}>
                Cancel
              </Button>
              {selectedId !== "new" && (
                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto text-destructive"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(selectedId!)}
                >
                  Remove
                </Button>
              )}
            </div>
          </form>
        )}
      </div>
    </Page>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
