import { useEffect, useRef, useState } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import { AudioLines, History, LogOut, Menu, Phone, Users } from "lucide-react";

import { signOut } from "@/lib/auth-client";
import { clearBearer } from "@/lib/bearer";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "@/lib/config";
import { CallSessionProvider, useCallSession } from "@/lib/call-session";

const NAV = [
  { label: "Console", to: "/", icon: Phone },
  { label: "Calls", to: "/calls", icon: History },
  { label: "Staff", to: "/staff", icon: Users },
] as const;

const row = "flex h-9 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors";
const iconBtn =
  "tap grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-[color,background-color,transform] active:scale-[0.96] pf-hover:bg-accent pf-hover:text-foreground";

function signOutAndReturn() {
  void signOut().finally(() => {
    clearBearer();
    window.location.href = "/login";
  });
}

export function AppLayout() {
  return (
    <CallSessionProvider>
      <Shell />
    </CallSessionProvider>
  );
}

function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  const sidebarBody = (
    <>
      <div className="flex h-12 items-center px-2">
        <Link to="/" onClick={closeMobile} className="flex items-center gap-2 rounded-lg px-2 py-1">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background">
            <AudioLines className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">{PRODUCT_NAME}</span>
        </Link>
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            onClick={closeMobile}
            className={row}
            activeProps={{ className: "bg-accent font-medium text-foreground" }}
            inactiveProps={{ className: "text-muted-foreground pf-hover:text-foreground" }}
          >
            <item.icon className="h-4.5 w-4.5" /> {item.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      <UserFooter />
    </>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar md:flex">{sidebarBody}</aside>

      <MobileDrawer open={mobileOpen} onClose={closeMobile}>
        {sidebarBody}
      </MobileDrawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-1 px-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className={iconBtn}
          >
            <Menu className="h-4 w-4" />
          </button>
          <Link to="/" className="flex items-center gap-2 px-1">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-background">
              <AudioLines className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">{PRODUCT_NAME}</span>
          </Link>
        </header>
        <Outlet />
      </div>
    </div>
  );
}

function UserFooter() {
  const { userName } = useCallSession();
  return (
    <div className="flex items-center gap-1 px-2 pb-2 pt-1">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold capitalize">
        {userName.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate px-1 text-sm">{userName}</span>
      <button
        type="button"
        onClick={signOutAndReturn}
        aria-label="Sign out"
        className={cn(iconBtn, "h-7 w-7")}
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}

function MobileDrawer({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  // Backdrop click dismisses; wired imperatively (Esc is handled natively).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) dialog.close();
    };
    dialog.addEventListener("click", onBackdropClick);
    return () => dialog.removeEventListener("click", onBackdropClick);
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-label="Menu"
      onClose={onClose}
      className="fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-72 max-w-none rounded-none bg-transparent p-0 text-foreground backdrop:bg-black/40 md:hidden"
    >
      <div className="flex h-full flex-col bg-sidebar shadow-xl">{children}</div>
    </dialog>
  );
}
