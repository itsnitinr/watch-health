// Haptic feedback on phones via the Vibration API (Chrome on Android; a no-op elsewhere, e.g. iOS and desktop).
// It can only buzz for a set time, so "tap" is kept very short to feel like a tick rather than a vibration.
// On by default; the switch lives in the phone's More sheet and is remembered per device.

const KEY = "haptics";
const PATTERNS = { tap: 10, done: 25 } as const;
const listeners = new Set<() => void>();

export function hapticsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {}
  listeners.forEach((l) => l());
  if (on) haptic("tap");
}

/** For useSyncExternalStore: re-render when the setting changes, here or in another tab. */
export function subscribeHaptics(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export const hapticsSupported = () => typeof navigator !== "undefined" && "vibrate" in navigator;

/** "tap" for a deliberate press (tabs, toggles, sending); "done" when something you waited for finishes. */
export function haptic(kind: keyof typeof PATTERNS = "tap") {
  if (!hapticsSupported() || !hapticsEnabled()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {}
}
