"use client";

import { Info } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { band, type ScorePart } from "@/lib/scores";
import { cn } from "@/lib/utils";

const TONE = { good: "text-good", warn: "text-warn", bad: "text-bad" } as const;

/** Score in a ring, with its band label underneath. */
export function ScoreDial({ score, color, size = 128, label }: {
  score: number | null; color: string; size?: number; label?: string;
}) {
  const reduce = useReducedMotion();
  const stroke = size * 0.08;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const b = score == null ? null : band(score);
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.15} strokeWidth={stroke} />
          {score != null && (
            <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={c} initial={reduce ? false : { strokeDashoffset: c }}
              animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular font-semibold tracking-tight" style={{ fontSize: size * 0.3 }}>{score ?? "-"}</span>
          {label && <span className="text-[11px] text-muted-foreground">{label}</span>}
        </div>
      </div>
      {b && <span className={cn("text-sm font-medium", TONE[b.tone])}>{b.label}</span>}
    </div>
  );
}

/** Each part of a score: name, explanation, its own 0-100 bar, and weight. */
export function ScoreParts({ parts, color, compact = false }: { parts: ScorePart[]; color: string; compact?: boolean }) {
  return (
    <ul className={cn(compact ? "space-y-2" : "space-y-3")}>
      {parts.map((p) => (
        <li key={p.key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <div className="min-w-0">
            <span className="text-sm font-medium">{p.label}</span>
            {!compact && <span className="ml-1.5 text-[11px] text-muted-foreground">{p.weight}%</span>}
            <div className="truncate text-xs text-muted-foreground">{p.detail}</div>
          </div>
          <span className="tabular w-8 text-right text-sm font-semibold">{p.score ?? "-"}</span>
          <div className="col-span-2 h-1.5 overflow-hidden rounded-full" style={{ background: `color-mix(in oklab, ${color} 14%, transparent)` }}>
            {p.score != null && <div className="h-full rounded-full" style={{ width: `${p.score}%`, background: color }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ScoreHelp({ title, text }: { title: string; text: string }) {
  return (
    <Popover>
      <PopoverTrigger className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`How the ${title.toLowerCase()} is calculated`}>
        <Info className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="end">
        <p className="mb-1 font-medium">How the {title.toLowerCase()} works</p>
        <p className="text-muted-foreground">{text}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Each part is scored 0 to 100 against your own recent norms and weighted as shown. 85+ is excellent, 70 to 84 good, 55 to 69 fair, below 55 low. These are this dashboard&apos;s estimates, not medical measures.
        </p>
      </PopoverContent>
    </Popover>
  );
}
