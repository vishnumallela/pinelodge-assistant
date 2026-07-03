import { cn } from "@/lib/utils";

export const Textarea = ({ className, ...props }: React.ComponentProps<"textarea">) => (
  <textarea
    className={cn(
      "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
      "placeholder:text-muted-foreground",
      "transition-shadow duration-150 [transition-timing-function:var(--ease-out)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
      className,
    )}
    {...props}
  />
);
