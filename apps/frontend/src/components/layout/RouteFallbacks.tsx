import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[60vh] w-full place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">{children}</div>
    </div>
  );
}

export function NotFound() {
  return (
    <Centered>
      <p className="text-sm font-medium tracking-widest text-muted-foreground">404</p>
      <h1 className="font-display text-2xl font-normal tracking-normal">This page doesn’t exist</h1>
      <p className="text-sm text-muted-foreground">
        The link may be broken or the page may have moved.
      </p>
      <Link
        to="/"
        className="mt-1 inline-flex h-9 select-none items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors duration-150 pf-hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to the console
      </Link>
    </Centered>
  );
}

export function RouteError({ error }: { error: Error }) {
  const router = useRouter();
  return (
    <Centered>
      <h1 className="font-display text-2xl font-normal tracking-normal">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        {error.message || "An unexpected error occurred."}
      </p>
      <Button onClick={() => router.invalidate()} className="mt-1">
        Try again
      </Button>
    </Centered>
  );
}
