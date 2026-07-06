import { cn } from "@/lib/utils";

type Variant = "default" | "brand" | "success" | "muted" | "destructive" | "outline";

const VARIANTS: Record<Variant, string> = {
  default: "bg-secondary text-secondary-foreground",
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
  outline: "border border-border text-muted-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
