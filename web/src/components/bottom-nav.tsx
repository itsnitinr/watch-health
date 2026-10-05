"use client";

import { ChevronRight, Ellipsis, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { HapticsToggle } from "@/components/haptics-toggle";
import { NAV } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { haptic } from "@/lib/haptics";
import { cn } from "@/lib/utils";

const TABS = NAV.filter((n) => n.tab);
const MORE = NAV.filter((n) => !n.tab);

/** Phone navigation: a tab bar along the bottom (the sidebar takes over from md up). Its height is --bottom-nav in globals.css. */
export function BottomNav({ lastSync }: { lastSync: string | null }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = MORE.some((n) => n.match(pathname));

  return (
    <>
      <nav aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/75 md:hidden">
        <ul className="flex h-16">
          {TABS.map((item) => {
            const active = item.match(pathname);
            return (
              <li key={item.href} className="flex-1">
                <Link href={item.href} onClick={() => haptic()} aria-current={active ? "page" : undefined} className={tabClass}>
                  <TabIcon active={active}><item.icon className={cn("size-5", active && item.color)} /></TabIcon>
                  <span className={cn(active && "font-medium text-foreground")}>{item.short ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button type="button" onClick={() => { haptic(); setMoreOpen(true); }} aria-haspopup="dialog" aria-expanded={moreOpen}
              aria-current={inMore ? "page" : undefined} className={tabClass}>
              <TabIcon active={inMore || moreOpen}><Ellipsis className="size-5" /></TabIcon>
              <span className={cn((inMore || moreOpen) && "font-medium text-foreground")}>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="gap-0 rounded-t-2xl pb-[calc(env(safe-area-inset-bottom)+1rem)] md:hidden">
          <SheetHeader className="pb-2">
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">Other pages and settings</SheetDescription>
          </SheetHeader>
          <ul className="mx-4 divide-y overflow-hidden rounded-xl border bg-card">
            {MORE.map((item) => {
              const active = item.match(pathname);
              return (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => { haptic(); setMoreOpen(false); }} aria-current={active ? "page" : undefined}
                    className={cn("flex min-h-12 items-center gap-3 px-4 text-sm transition-colors active:bg-muted [-webkit-tap-highlight-color:transparent]",
                      active && "bg-muted/60 font-medium")}>
                    <item.icon className={cn("size-4 text-muted-foreground", active && item.color)} />
                    <span className="flex-1">{item.label}</span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mx-4 mt-4 space-y-3">
            <ThemeToggle />
            <HapticsToggle />
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="size-3.5 shrink-0" />
              {lastSync ? `Phone synced ${lastSync}` : "Phone not synced yet"}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

const tabClass = "flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground select-none [-webkit-tap-highlight-color:transparent]";

/** Material-style pill behind the active tab's icon. */
function TabIcon({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("flex h-7 w-14 items-center justify-center rounded-full transition-colors duration-200",
      active ? "bg-foreground/10 text-foreground" : "active:bg-muted")}>
      {children}
    </span>
  );
}
