import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { orpc, orpcClient } from "@/lib/orpc";
import { Page } from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const { data: staff = [] } = useQuery(orpc.staff.list.queryOptions());
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
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="hidden py-2 pr-4 font-medium sm:table-cell">Role</th>
              <th className="py-2 pr-4 font-medium">Department</th>
              <th className="hidden py-2 pr-4 font-medium md:table-cell">Ext.</th>
              <th className="hidden py-2 pr-4 font-medium md:table-cell">Shift</th>
              <th className="py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className="group relative border-b border-border/60">
                <td className="py-3 pr-4">
                  <button
                    type="button"
                    onClick={() => open(s)}
                    className="font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {s.name}
                  </button>
                </td>
                <td className="hidden py-3 pr-4 text-muted-foreground sm:table-cell">{s.role}</td>
                <td className="py-3 pr-4">{s.department}</td>
                <td className="hidden py-3 pr-4 tabular-nums text-muted-foreground md:table-cell">
                  {s.extension}
                </td>
                <td className="hidden py-3 pr-4 tabular-nums text-muted-foreground md:table-cell">
                  {s.shiftStart}–{s.shiftEnd}
                </td>
                <td className="py-3 text-right text-muted-foreground">
                  {s.active ? "Active" : "Inactive"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!editing && (
          <div>
            <Button variant="outline" onClick={openNew}>
              Add staff member
            </Button>
          </div>
        )}

        {editing && (
          <form
            className="flex max-w-xl flex-col gap-4 border-t border-border pt-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSave) save.mutate();
            }}
          >
            <h2 className="text-sm font-semibold tracking-tight">
              {selectedId === "new" ? "New staff member" : `Edit ${form.name || "staff member"}`}
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Role">
                <Input
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                />
              </Field>
              <Field label="Department">
                <Input
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="Admissions, Billing, Administration, Front Office, Nursing"
                />
              </Field>
              <Field label="Extension">
                <Input
                  value={form.extension}
                  onChange={(e) => setForm({ ...form, extension: e.target.value })}
                />
              </Field>
              <Field label="Shift start">
                <Input
                  type="time"
                  value={form.shiftStart}
                  onChange={(e) => setForm({ ...form, shiftStart: e.target.value })}
                />
              </Field>
              <Field label="Shift end">
                <Input
                  type="time"
                  value={form.shiftEnd}
                  onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Working days">
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
                        "h-8 rounded-md border px-3 text-xs font-medium transition-colors",
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
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="When off shift, send calls to">
                <select
                  aria-label="Fallback destination"
                  value={form.fallbackDestination}
                  onChange={(e) => setForm({ ...form, fallbackDestination: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="voicemail">Voicemail</option>
                  <option value="nursing">Nursing line</option>
                  {staff
                    .filter((s) => s.id !== selectedId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Status">
                <label className="flex h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label="Active — can receive calls"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="h-4 w-4 accent-foreground"
                  />
                  Active — can receive calls
                </label>
              </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
