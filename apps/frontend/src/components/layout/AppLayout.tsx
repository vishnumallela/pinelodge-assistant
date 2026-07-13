import { useEffect, useRef, useState } from "react";
import { Link, Outlet } from "@tanstack/react-router";
import {
  AudioLines,
  Building2,
  Check,
  ChevronsUpDown,
  LogOut,
  Menu,
  PhoneForwarded,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";

import { PromptEditor } from "@/components/prompt/PromptEditor";
import { VoiceSettingsPanel } from "@/components/voice/VoiceSettingsPanel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { signOut } from "@/lib/auth-client";
import { clearBearer } from "@/lib/bearer";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "@/lib/config";
import { CallSessionProvider, useCallSession } from "@/lib/call-session";
import { CenterProvider, useCenter } from "@/lib/center";
import { VoiceSettingsProvider } from "@/lib/voice-settings";

const NAV = [
  { label: "Call log", to: "/", icon: ScrollText },
  { label: "Staff", to: "/staff", icon: Users },
  { label: "Centers", to: "/centers", icon: Building2 },
  { label: "Phone line", to: "/phone", icon: PhoneForwarded },
  { label: "Settings", to: "/settings", icon: Settings },
] as const;

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
    <VoiceSettingsProvider>
      <CenterProvider>
        <CallSessionProvider>
          <Shell />
        </CallSessionProvider>
      </CenterProvider>
    </VoiceSettingsProvider>
  );
}

function Shell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  const sidebarBody = (
    <>
      <div className="flex h-14 items-center px-2">
        <Link
          to="/"
          onClick={closeMobile}
          className="flex items-center gap-2.5 rounded-lg px-2 py-1"
        >
          <span className="font-display text-[17px] leading-none tracking-normal">
            {PRODUCT_NAME}
          </span>
        </Link>
      </div>
      <div className="px-3 pb-2">
        <CenterSwitcher onPick={closeMobile} />
      </div>
      <nav className="flex flex-col gap-1 px-3 pt-1">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            onClick={closeMobile}
            className="flex h-10 items-center gap-3 rounded-full px-3.5 text-sm transition-colors"
            activeProps={{ className: "bg-accent font-medium text-foreground" }}
            inactiveProps={{
              className: "text-muted-foreground pf-hover:bg-accent/60 pf-hover:text-foreground",
            }}
          >
            <item.icon className="h-4.5 w-4.5" /> {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => {
            closeMobile();
            setPromptOpen(true);
          }}
          className="flex h-10 items-center gap-3 rounded-full px-3.5 text-left text-sm text-muted-foreground transition-colors pf-hover:bg-accent/60 pf-hover:text-foreground"
        >
          <SlidersHorizontal className="h-4.5 w-4.5" /> Prompt
        </button>
        <button
          type="button"
          onClick={() => {
            closeMobile();
            setVoiceOpen(true);
          }}
          className="flex h-10 items-center gap-3 rounded-full px-3.5 text-left text-sm text-muted-foreground transition-colors pf-hover:bg-accent/60 pf-hover:text-foreground"
        >
          <AudioLines className="h-4.5 w-4.5" /> Voice
        </button>
      </nav>
      <div className="flex-1" />
      <div className="mx-3 border-t border-border/60" />
      <UserFooter />
    </>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/60 bg-sidebar md:flex">
        {sidebarBody}
      </aside>

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
          <Link to="/" className="flex items-center gap-2.5 px-1">
            <span className="font-display text-[17px] leading-none tracking-normal">
              {PRODUCT_NAME}
            </span>
          </Link>
        </header>
        <Outlet />
      </div>

      <PromptEditor open={promptOpen} onOpenChange={setPromptOpen} />
      <VoiceSettingsPanel open={voiceOpen} onOpenChange={setVoiceOpen} />
    </div>
  );
}

/** Which center everything on screen belongs to. Every center-scoped page
 *  (call log, staff, prompt, new calls) follows this choice. */
function CenterSwitcher({ onPick }: { onPick: () => void }) {
  const { centers, center, setCenterId } = useCenter();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch center"
          className="tap flex w-full items-center gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 text-left transition-colors pf-hover:bg-accent/60"
        >
          <Building2 className="h-4 w-4 shrink-0 text-brand" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-tight text-foreground">
              {center?.name ?? "Loading…"}
            </span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              {center?.phoneNumber || "No phone line"}
            </span>
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {centers.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setCenterId(c.id);
              setOpen(false);
              onPick();
            }}
            className="tap flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors pf-hover:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate", !c.active && "text-muted-foreground")}>
                {c.name}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {c.phoneNumber || "No phone line"}
              </span>
            </span>
            {c.id === center?.id && <Check className="h-3.5 w-3.5 shrink-0 text-brand" />}
          </button>
        ))}
        <div className="mx-1 my-1 border-t border-border/60" />
        <Link
          to="/centers"
          onClick={() => {
            setOpen(false);
            onPick();
          }}
          className="tap flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-muted-foreground transition-colors pf-hover:bg-accent pf-hover:text-foreground"
        >
          Manage centers
        </Link>
      </PopoverContent>
    </Popover>
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
