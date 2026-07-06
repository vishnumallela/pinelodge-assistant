import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // Generic primitive: call sites pass htmlFor or wrap their control.
    // oxlint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      className={cn(
        "text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
