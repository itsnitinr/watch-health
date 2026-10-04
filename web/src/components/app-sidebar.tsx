"use client";

import { Activity, BedDouble, Dumbbell, HeartPulse, RefreshCw, Sparkles, Sun, TrendingUp, Watch } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";

const NAV = [
  { href: "/", label: "Today", icon: Sun, color: "text-foreground", match: (p: string) => p === "/" || p.startsWith("/day/") },
  { href: "/activity", label: "Activity", icon: Activity, color: "text-activity", match: (p: string) => p.startsWith("/activity") },
  { href: "/sleep", label: "Sleep", icon: BedDouble, color: "text-sleep", match: (p: string) => p.startsWith("/sleep") },
  { href: "/heart", label: "Heart & body", icon: HeartPulse, color: "text-heart", match: (p: string) => p.startsWith("/heart") },
  { href: "/workouts", label: "Workouts", icon: Dumbbell, color: "text-exercise", match: (p: string) => p.startsWith("/workouts") },
  { href: "/trends", label: "Trends", icon: TrendingUp, color: "text-foreground", match: (p: string) => p.startsWith("/trends") },
  { href: "/chat", label: "Ask", icon: Sparkles, color: "text-foreground", match: (p: string) => p.startsWith("/chat") },
];

export function AppSidebar({ lastSync }: { lastSync: string | null }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/" onClick={() => setOpenMobile(false)}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Watch className="size-4" />
                </span>
                <span className="grid leading-tight">
                  <span className="font-semibold">Watch Health</span>
                  <span className="text-xs text-muted-foreground">Galaxy Watch 7</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = item.match(pathname);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href} onClick={() => setOpenMobile(false)}>
                        <item.icon className={active ? item.color : undefined} />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-3 group-data-[collapsible=icon]:hidden">
        <div className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
          <RefreshCw className="mt-0.5 size-3.5 shrink-0" />
          <span>{lastSync ? `Phone synced ${lastSync}` : "Phone not synced yet"}</span>
        </div>
        <ThemeToggle />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
