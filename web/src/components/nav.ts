import { Activity, BedDouble, Dumbbell, HeartPulse, Sparkles, Sun, TrendingUp } from "lucide-react";

/** Every page, in sidebar order. `tab` marks the ones that get their own bottom tab on a phone; the rest go under More. */
export const NAV = [
  { href: "/", label: "Today", icon: Sun, color: "text-foreground", tab: true, match: (p: string) => p === "/" || p.startsWith("/day/") },
  { href: "/activity", label: "Activity", icon: Activity, color: "text-activity", tab: true, match: (p: string) => p.startsWith("/activity") },
  { href: "/sleep", label: "Sleep", icon: BedDouble, color: "text-sleep", tab: true, match: (p: string) => p.startsWith("/sleep") },
  { href: "/heart", label: "Heart & body", short: "Heart", icon: HeartPulse, color: "text-heart", tab: true, match: (p: string) => p.startsWith("/heart") },
  { href: "/workouts", label: "Workouts", icon: Dumbbell, color: "text-exercise", tab: false, match: (p: string) => p.startsWith("/workouts") },
  { href: "/trends", label: "Trends", icon: TrendingUp, color: "text-foreground", tab: false, match: (p: string) => p.startsWith("/trends") },
  { href: "/chat", label: "Ask", icon: Sparkles, color: "text-foreground", tab: false, match: (p: string) => p.startsWith("/chat") },
];
