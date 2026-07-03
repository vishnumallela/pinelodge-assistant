import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline" | "destructive";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-foreground text-background pf-hover:bg-foreground/90 active:bg-foreground/80",
  secondary: "bg-secondary text-secondary-foreground pf-hover:bg-secondary/80",
  ghost: "pf-hover:bg-accent pf-hover:text-accent-foreground",
  outline: "border border-border bg-background pf-hover:bg-accent pf-hover:text-accent-foreground",
  destructive: "bg-destructive text-white pf-hover:bg-destructive/90",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-6 text-sm",
  icon: "h-9 w-9",
};

export interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
}

export const Button = ({ className, variant = "primary", size = "md", ...props }: ButtonProps) => (
  <button
    className={cn(
      "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium",
      "transition-[background-color,color,box-shadow,transform] duration-150 [transition-timing-function:var(--ease-out)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      "active:scale-[0.96]",
      "disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground disabled:shadow-none",
      VARIANTS[variant],
      SIZES[size],
      className,
    )}
    {...props}
  />
);
