import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useCenter } from "@/lib/center";
import { orpc } from "@/lib/orpc";
import { AGENT_NAME } from "@/lib/receptionist-agent";

const PLACEHOLDERS = ["{{greeting}}", "{{staff_directory}}", "{{unavailable}}", "{{fallback}}"];

/** Live prompt editor: the template drives every future call; the rendered
 *  preview shows exactly what the agent receives right now. */
export function PromptEditor({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { center, centerId } = useCenter();
  const { data } = useQuery(
    orpc.prompt.get.queryOptions({
      input: { centerId },
      enabled: open && centerId !== "",
      refetchOnWindowFocus: false,
    }),
  );

  const [template, setTemplate] = useState("");
  const [greeting, setGreeting] = useState("");
  useEffect(() => {
    if (data) {
      setTemplate(data.template);
      setGreeting(data.greeting);
    }
  }, [data]);

  const dirty = data !== undefined && (template !== data.template || greeting !== data.greeting);

  const save = useMutation(
    orpc.prompt.save.mutationOptions({
      onSuccess: (next) => {
        qc.setQueryData(orpc.prompt.get.queryKey({ input: { centerId } }), next);
        toast.success("Prompt saved. It applies to the next call.");
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-2xl">
        <SheetHeader>
          <SheetTitle>Agent prompt{center ? ` — ${center.name}` : ""}</SheetTitle>
          <SheetDescription>
            What {AGENT_NAME} is told on every call to this center. Placeholders fill in live from
            the center's staff directory when the call starts.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          <div className="space-y-1.5">
            <Label htmlFor="prompt-greeting">Greeting (spoken verbatim)</Label>
            <Input
              id="prompt-greeting"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt-template">Template</Label>
              <div className="flex flex-wrap gap-1">
                {PLACEHOLDERS.map((p) => (
                  <Badge key={p} variant="muted" className="font-mono text-[10.5px]">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
            <Textarea
              id="prompt-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={14}
              spellCheck={false}
              className="font-mono text-[12.5px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Live prompt — as the agent sees it right now</Label>
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/70 bg-secondary/50 p-4 text-[12px] leading-relaxed text-foreground scrollbar-subtle">
              {data?.prompt ?? "Loading…"}
            </pre>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button
            variant="ghost"
            className="mr-auto text-muted-foreground"
            onClick={() => {
              if (!data) return;
              setTemplate(data.defaults.template);
              setGreeting(data.defaults.greeting);
            }}
          >
            <RotateCcw className="mr-1.5 size-3.5" /> Reset to default
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!dirty || save.isPending || template.trim() === "" || greeting.trim() === ""}
            onClick={() => save.mutate({ centerId, template, greeting })}
            className="bg-brand text-brand-foreground pf-hover:bg-brand/90"
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
