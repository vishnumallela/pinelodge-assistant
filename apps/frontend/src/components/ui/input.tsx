import { cn } from "@/lib/utils";

export const Input = ({ className, type = "text", ...props }: React.ComponentProps<"input">) => (
  <input
    type={type}
    className={cn(
      "h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-sm",
      "placeholder:text-muted-foreground",
      "transition-shadow duration-150 [transition-timing-function:var(--ease-out)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
      className,
    )}
    {...props}
  />
);
