import { useState } from "react";
import { Loader2 } from "lucide-react";

import { PineMark } from "@/components/brand/PineMark";
import { toast } from "sonner";

import { signIn } from "@/lib/auth-client";
import { FACILITY_NAME, PRODUCT_NAME } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Single-admin sign-in; account creation is disabled server-side. */
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      toast.error("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await signIn.email({ email: addr, password });
      if (error) throw new Error(error.message ?? "Invalid email or password.");
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-foreground text-background">
            <PineMark className="h-7 w-7" />
          </span>
          <div>
            <h1 className="font-display text-balance text-[30px] font-normal leading-tight tracking-normal">
              {PRODUCT_NAME}
            </h1>
            <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
              Admin console for {FACILITY_NAME}.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label htmlFor="email" className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Email</span>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              className="h-11"
            />
          </label>
          <label htmlFor="password" className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Password</span>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="h-11"
            />
          </label>

          <Button type="submit" size="lg" disabled={busy} className="mt-1 rounded-xl">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
