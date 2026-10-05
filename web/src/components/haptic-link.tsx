"use client";

import Link from "next/link";
import { haptic } from "@/lib/haptics";

/** A Link that gives a light tap of haptic feedback when pressed; usable from server components. */
export function HapticLink({ onClick, ...props }: React.ComponentProps<typeof Link>) {
  return <Link {...props} onClick={(e) => { haptic(); onClick?.(e); }} />;
}
