"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const subscribe = () => () => {};

/** Light / system / dark. Renders a placeholder until mounted, since the theme is only known client-side. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  if (!mounted) return <div className="h-8" />;
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v)}
      className="w-full" aria-label="Theme">
      <ToggleGroupItem value="light" aria-label="Light theme" className="flex-1"><Sun /></ToggleGroupItem>
      <ToggleGroupItem value="system" aria-label="Match system theme" className="flex-1"><Monitor /></ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme" className="flex-1"><Moon /></ToggleGroupItem>
    </ToggleGroup>
  );
}
