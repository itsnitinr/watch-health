"use client";

import { motion, useReducedMotion } from "motion/react";

export type Ring = { label: string; value: number; goal: number; color: string; display: string; goalDisplay: string };

/**
 * Concentric progress rings (outer = first). A ring past 100% keeps going around,
 * so beating a goal is visible rather than clipped.
 */
export function ProgressRings({ rings, size = 176 }: { rings: Ring[]; size?: number }) {
  const reduce = useReducedMotion();
  const stroke = size * 0.085;
  const gap = stroke * 0.35;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" role="img"
      aria-label={rings.map((r) => `${r.label} ${r.display} of ${r.goalDisplay}`).join(", ")}>
      {rings.map((r, i) => {
        const radius = size / 2 - stroke / 2 - i * (stroke + gap);
        const c = 2 * Math.PI * radius;
        const frac = r.goal > 0 ? Math.min(r.value / r.goal, 2) : 0;
        return (
          <g key={r.label}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={r.color} strokeOpacity={0.16} strokeWidth={stroke} />
            <motion.circle
              cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={r.color} strokeWidth={stroke} strokeLinecap="round"
              strokeDasharray={c}
              initial={reduce ? false : { strokeDashoffset: c }}
              animate={{ strokeDashoffset: c * (1 - Math.min(frac, 1)) }}
              transition={{ duration: 1.1, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
            />
            {frac > 1 && (
              <motion.circle
                cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={r.color} strokeWidth={stroke} strokeLinecap="round"
                strokeDasharray={c} style={{ filter: "brightness(0.85)" }}
                initial={reduce ? false : { strokeDashoffset: c }}
                animate={{ strokeDashoffset: c * (1 - (frac - 1)) }}
                transition={{ duration: 0.8, delay: 1 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A horizontal stacked bar (e.g. sleep stage proportions) with a 2px gap between segments. */
export function StackedBar({ parts, height = 10 }: { parts: { label: string; value: number; color: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height }}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.label} title={`${p.label} ${Math.round((p.value / total) * 100)}%`}
          style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}
