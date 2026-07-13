import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Native select styled like Input: same height, border, focus ring, and a
 *  16px font on mobile so iOS never zooms the page. The chevron is ours —
 *  the UA arrow never matches. */
export const Select = ({ className, children, ...props }: React.ComponentProps<"select">) => (
  <span className={cn("relative block w-full", className)}>
    <select
      className={cn(
        "h-10 w-full appearance-none truncate rounded-md border border-input bg-background",
        "py-1 pl-3 pr-9 text-base sm:text-sm",
        "transition-shadow duration-150 [transition-timing-function:var(--ease-out)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-foreground",
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
  </span>
);
