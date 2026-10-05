"use client";

import { BedDouble, ChevronDown, Flame, Info, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { haptic } from "@/lib/haptics";
import { band, type Band, type ScorePart } from "@/lib/scores";
import { cn } from "@/lib/utils";

const TONE = { good: "text-good", warn: "text-warn", bad: "text-bad", neutral: "text-foreground" } as const;

/**
 * Score in a ring, with its band label underneath. `fluid` makes the ring fill its container's
 * width up to `size`, with the number scaled to match.
 */
export function ScoreDial({ score, color, size = 128, label, bandInfo, fluid = false }: {
  score: number | null; color: string; size?: number; label?: string; bandInfo?: Band | null; fluid?: boolean;
}) {
  const reduce = useReducedMotion();
  const stroke = size * 0.08;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const b = bandInfo !== undefined ? bandInfo : score == null ? null : band(score);
  return (
    <div className={cn("flex shrink-0 flex-col items-center gap-1", fluid && "w-full")}>
      <div className={cn("relative", fluid && "@container aspect-square w-full")} style={fluid ? { maxWidth: size } : { width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeOpacity={0.15} strokeWidth={stroke} />
          {score != null && (
            <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={c} initial={reduce ? false : { strokeDashoffset: c }}
              animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular font-semibold tracking-tight" style={{ fontSize: fluid ? "30cqw" : size * 0.3 }}>{score ?? "-"}</span>
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

const SCALE_NOTE = "Each part is scored 0 to 100 against your own recent norms and weighted as shown. 85+ is excellent, 70 to 84 good, 55 to 69 fair, below 55 low.";

export function ScoreHelp({ title, text, scale = SCALE_NOTE }: { title: string; text: string; scale?: string }) {
  return (
    <Popover>
      <PopoverTrigger className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={`How the ${title.toLowerCase()} is calculated`}>
        <Info className="size-4" />
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="end">
        <p className="mb-1 font-medium">How the {title.toLowerCase()} works</p>
        <p className="text-muted-foreground">{text}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {scale} These are this dashboard&apos;s estimates, not medical measures.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export type ScoreSummary = {
  key: "energy" | "sleep" | "strain";
  title: string;
  score: number | null;
  band: Band | null;
  /** One line under the dial: advice, or why there is no score. */
  note: string;
  parts: ScorePart[];
  help: string;
  /** Replaces the help popover's note on how the 0-100 scale reads. */
  scale?: string;
  /** Extra context shown above the parts, e.g. why a score was capped. */
  remark?: string;
  link?: { href: string; label: string };
};

const SUMMARY_STYLE = {
  energy: { icon: Zap, color: "var(--energy)", text: "text-energy" },
  sleep: { icon: BedDouble, color: "var(--sleep)", text: "text-sleep" },
  strain: { icon: Flame, color: "var(--strain)", text: "text-strain" },
} as const;

/** The day's scores as dials; tapping one reveals what went into it. */
export function ScoreSummaries({ items }: { items: ScoreSummary[] }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<ScoreSummary["key"] | null>(null);
  const sel = items.find((x) => x.key === open) ?? null;
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {items.map((x) => {
          const st = SUMMARY_STYLE[x.key];
          const active = open === x.key;
          return (
            <button key={x.key} type="button" onClick={() => { haptic(); setOpen(active ? null : x.key); }} aria-expanded={active}
              aria-controls="score-breakdown"
              className={cn("group flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 pb-2 pt-1.5 text-center transition-colors",
                "hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring", active && "bg-muted/60")}>
              <span className={cn("inline-flex items-center gap-1 text-xs font-medium", st.text)}>
                <st.icon className="size-3.5" strokeWidth={2.25} />{x.title}
              </span>
              <ScoreDial score={x.score} color={st.color} size={112} bandInfo={x.band} fluid />
              <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{x.note}</span>
              <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", active && "rotate-180")} aria-hidden />
            </button>
          );
        })}
      </div>
      <AnimatePresence initial={false} mode="wait">
        {sel && (
          <motion.div key={sel.key} id="score-breakdown" className="overflow-hidden"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <div className="mt-3 border-t pt-3">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="flex-1 text-sm font-medium">What went into your {sel.title.toLowerCase()} score</h3>
                {sel.link && (
                  <Link href={sel.link.href} className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    {sel.link.label}
                  </Link>
                )}
                <ScoreHelp title={`${sel.title} score`} text={sel.help} scale={sel.scale} />
              </div>
              {sel.remark && <p className="mb-3 text-xs text-muted-foreground">{sel.remark}</p>}
              {sel.parts.length ? <ScoreParts parts={sel.parts} color={SUMMARY_STYLE[sel.key].color} compact />
                : <p className="text-sm text-muted-foreground">{sel.note}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
