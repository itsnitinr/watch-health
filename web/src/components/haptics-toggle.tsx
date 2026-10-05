"use client";

import { Vibrate } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { hapticsEnabled, hapticsSupported, setHapticsEnabled, subscribeHaptics } from "@/lib/haptics";

/** On/off switch for haptic feedback. Hidden where the browser can't vibrate. */
export function HapticsToggle() {
  const supported = useSyncExternalStore(subscribeHaptics, hapticsSupported, () => false);
  const on = useSyncExternalStore(subscribeHaptics, hapticsEnabled, () => true);
  if (!supported) return null;
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-xl border bg-card px-4 text-sm">
      <Vibrate className="size-4 text-muted-foreground" />
      <span className="flex-1">Haptic feedback</span>
      <Switch checked={on} onCheckedChange={setHapticsEnabled} />
    </label>
  );
}
