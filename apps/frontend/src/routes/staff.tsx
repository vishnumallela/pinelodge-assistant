import { useEffect, useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resetStaff, setStaff, useStaff, type StaffMember } from "@/lib/staff";
import { AGENT_NAME } from "@/lib/receptionist-agent";

export function StaffPage() {
  const saved = useStaff();
  const [rows, setRows] = useState<StaffMember[]>(saved);
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  // Resync editable rows when the store changes from outside (Reset button,
  // another tab). The saved reference is stable between such changes.
  useEffect(() => setRows(saved), [saved]);

  const update = (id: string, patch: Partial<StaffMember>) =>
    setRows((r) => r.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const save = () => {
    const clean = rows
      .map((s) => ({
        ...s,
        name: s.name.trim(),
        section: s.section.trim(),
        handles: s.handles.trim(),
      }))
      .filter((s) => s.name !== "" && s.section !== "");
    if (clean.length === 0) {
      toast.error("Keep at least one staff member.");
      return;
    }
    setRows(clean);
    setStaff(clean);
    toast.success("Staff directory saved. It applies to the next call.");
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-5">
        <h1 className="font-display text-[28px] leading-tight">Staff directory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who {AGENT_NAME} can redirect callers to. The last row is her fallback for anything she
          cannot place. Changes apply to the next call.
        </p>

        <div className="mt-6 space-y-3">
          <div className="hidden grid-cols-[1fr_1fr_2fr_2rem] gap-2 px-1 text-xs font-medium text-muted-foreground md:grid">
            <span>Name</span>
            <span>Section</span>
            <span>Handles</span>
            <span />
          </div>
          {rows.map((s) => (
            <div
              key={s.id}
              className="grid grid-cols-1 gap-2 rounded-xl border border-border/60 p-3 md:grid-cols-[1fr_1fr_2fr_2rem] md:items-center md:border-0 md:p-0 md:px-1"
            >
              <Input
                value={s.name}
                placeholder="Name"
                aria-label="Name"
                onChange={(e) => update(s.id, { name: e.target.value })}
              />
              <Input
                value={s.section}
                placeholder="Section"
                aria-label="Section"
                onChange={(e) => update(s.id, { section: e.target.value })}
              />
              <Input
                value={s.handles}
                placeholder="tours, invoices, …"
                aria-label="Handles"
                onChange={(e) => update(s.id, { handles: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${s.name || "row"}`}
                className="justify-self-end text-muted-foreground"
                onClick={() => setRows((r) => r.filter((x) => x.id !== s.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setRows((r) => [
                ...r,
                { id: crypto.randomUUID(), name: "", section: "", handles: "" },
              ])
            }
          >
            <Plus className="mr-1.5 size-4" /> Add person
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              resetStaff();
              toast.success("Reset to the default directory.");
            }}
          >
            <RotateCcw className="mr-1.5 size-4" /> Reset to defaults
          </Button>
          <div className="flex-1" />
          <Button onClick={save} disabled={!dirty}>
            Save
          </Button>
        </div>
      </div>
    </main>
  );
}
