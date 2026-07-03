import { useEffect, useRef } from "react";

export function Page({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [title]);

  return (
    <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-3xl px-4 pb-6 pt-8 md:px-5">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="font-display text-[26px] font-normal leading-tight tracking-normal focus:outline-none"
        >
          {title}
        </h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
