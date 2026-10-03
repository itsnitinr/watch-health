"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Segmented tabs over panels rendered on the server; only the chosen one is mounted. */
export function DetailTabs({ tabs }: { tabs: { value: string; label: string; content: React.ReactNode }[] }) {
  const [current, setCurrent] = useState(tabs[0].value);
  const active = tabs.find((t) => t.value === current) ?? tabs[0];
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Detail" className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
        {tabs.map((t) => (
          <button key={t.value} type="button" role="tab" id={`tab-${t.value}`} aria-selected={t.value === active.value}
            aria-controls={`panel-${t.value}`} onClick={() => setCurrent(t.value)}
            className={cn("rounded-md px-3 py-1.5 transition-colors",
              t.value === active.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${active.value}`} aria-labelledby={`tab-${active.value}`}>{active.content}</div>
    </div>
  );
}
