import { useState } from "react";
import { AudioLines, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { signIn, signUp } from "@/lib/auth-client";
import { FACILITY_NAME, PRODUCT_NAME } from "@/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function usernameFromEmail(email: string): string {
  const base = (email.split("@")[0] ?? "user")
    .replace(/[^a-z0-9_]/gi, "")
    .toLowerCase()
    .slice(0, 20);
  return `${base || "user"}_${crypto.randomUUID().slice(0, 4)}`;
}

export function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
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
      if (mode === "signup") {
        const { error } = await signUp.email({
          email: addr,
          username: usernameFromEmail(addr),
          name: name.trim() || (addr.split("@")[0] ?? addr),
          password,
        });
        if (error) {
          const taken = /already|exist/i.test(error.message ?? "");
          throw new Error(
            taken
              ? "An account with this email already exists. Sign in instead."
              : (error.message ?? "Could not create account."),
          );
        }
      } else {
        const { error } = await signIn.email({ email: addr, password });
        if (error) throw new Error(error.message ?? "Invalid email or password.");
      }
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
          <span className="grid h-11 w-11 place-items-center rounded-full bg-foreground text-background">
            <AudioLines className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-balance text-[30px] font-normal leading-tight tracking-normal">
              {PRODUCT_NAME}
            </h1>
            <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
              Front desk console for {FACILITY_NAME}.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <label htmlFor="name" className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Name</span>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                className="h-11"
              />
            </label>
          )}
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
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="h-11"
            />
          </label>

          <Button type="submit" size="lg" disabled={busy} className="mt-1 rounded-xl">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button
            type="button"
            className="relative rounded-sm font-medium text-foreground underline-offset-4 before:absolute before:-inset-x-2 before:-inset-y-2.5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
