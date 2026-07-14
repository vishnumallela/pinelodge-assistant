import { cn } from "@/lib/utils";

export function PageShell({
  title,
  subtitle,
  action,
  narrow,
  children,
}: {
  title: string;
  subtitle: React.ReactNode;
  action?: React.ReactNode;
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle">
      <div className={cn("w-full px-5 py-10 md:px-8", narrow && "mx-auto max-w-4xl md:px-6")}>
        <header className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-display text-[34px] leading-none text-foreground">{title}</h1>
            <p className="text-[14px] text-muted-foreground">{subtitle}</p>
          </div>
          {action}
        </header>
        {children}
      </div>
    </main>
  );
}
