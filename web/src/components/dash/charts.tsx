"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, type TooltipContentProps,
} from "recharts";
import { STAGES, ZONE_COLORS } from "@/lib/palette";
import { fmtClock, fmtDay, fmtMinutes, fmtNum, fmtPaceSec, fmtPeriod, fmtTimeOfNight, titleCase, type Period } from "@/lib/format";

type Point = { day: string; value: number | null };
type ValueFormat = "number" | "minutes";

const AXIS = { stroke: "var(--chart-axis)", tick: { fill: "var(--chart-ink)", fontSize: 11 }, tickLine: false } as const;
const GRID = <CartesianGrid vertical={false} stroke="var(--chart-grid)" />;
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };

const fmtValue = (v: number, format: ValueFormat, digits: number) =>
  format === "minutes" ? fmtMinutes(v) : fmtNum(v, digits);
const fmtTick = (v: number, format: ValueFormat, digits: number) =>
  format === "minutes" ? `${Math.round(v / 60)}h` : v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : fmtNum(v, digits);
const fmtX = (period: Period) => (d: string) =>
  period === "month" ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short" }) : fmtDay(d);

export function TooltipBox({ title, rows, hint }: {
  title: string; rows: { label: string; value: string; color?: string }[]; hint?: string;
}) {
  return (
    <div className="min-w-32 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-medium text-muted-foreground">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 py-0.5">
          {r.color && <span className="inline-block h-[3px] w-3 rounded-full" style={{ background: r.color }} />}
          <span className="tabular font-semibold">{r.value}</span>
          <span className="text-muted-foreground">{r.label}</span>
        </div>
      ))}
      {hint && <div className="mt-1 border-t pt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; shape?: "line" | "dot" | "rect" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className={it.shape === "line" ? "h-[3px] w-3.5 rounded-full" : it.shape === "dot" ? "size-2 rounded-full" : "size-2.5 rounded-[3px]"}
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function useDayClick(hrefPrefix?: string) {
  const router = useRouter();
  if (!hrefPrefix) return undefined;
  return (state: { activeLabel?: string | number }) => {
    if (state?.activeLabel != null) router.push(`${hrefPrefix}${state.activeLabel}`);
  };
}

export function DailyColumns({
  data, label, color, goal, hrefPrefix, period = "day", format = "number", digits = 0, height = 220, highlight,
}: {
  data: Point[]; label: string; color: string; goal?: number; hrefPrefix?: string; period?: Period;
  format?: ValueFormat; digits?: number; height?: number; highlight?: string;
}) {
  const onClick = useDayClick(hrefPrefix);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={MARGIN} onClick={onClick} style={{ cursor: hrefPrefix ? "pointer" : undefined }}>
        {GRID}
        <XAxis dataKey="day" {...AXIS} tickFormatter={fmtX(period)} minTickGap={20} />
        <YAxis {...AXIS} axisLine={false} width={40} tickFormatter={(v) => fmtTick(v, format, digits)}
          ticks={format === "minutes" ? [0, 120, 240, 360, 480, 600] : undefined} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length || payload[0].value == null) return null;
            const p = payload[0].payload as Point;
            return <TooltipBox title={fmtPeriod(p.day, period)} rows={[{ label, value: fmtValue(Number(p.value), format, digits), color }]}
              hint={hrefPrefix ? "Click to open this day" : undefined} />;
          }}
        />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={24}
          shape={highlight ? (props: { x?: number; y?: number; width?: number; height?: number; payload?: Point }) => (
            <rect x={props.x} y={props.y} width={props.width} height={Math.max(0, props.height ?? 0)} rx={4} fill={color}
              opacity={props.payload?.day === highlight ? 1 : 0.45} />
          ) : undefined} />
        {goal && <ReferenceLine y={goal} stroke="var(--muted-foreground)" strokeDasharray="0" strokeWidth={1}
          label={{ value: "goal", position: "insideTopLeft", fill: "var(--chart-ink)", fontSize: 10 }} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Daily values as quiet dots with the 7-day average as the line to read. */
export function TrendChart({
  data, label, color, digits = 0, format = "number", hrefPrefix, height = 220, goal,
}: {
  data: { day: string; value: number | null; avg: number | null }[]; label: string; color: string; digits?: number;
  format?: ValueFormat; hrefPrefix?: string; height?: number; goal?: number;
}) {
  const onClick = useDayClick(hrefPrefix);
  const gid = useId().replace(/:/g, "");
  // Durations get whole-hour ticks so labels never repeat ("8h, 8h")
  const vals = data.flatMap((d) => [d.value, d.avg]).filter((v): v is number => v != null).concat(goal ?? []);
  const hourTicks = format === "minutes" && vals.length
    ? Array.from({ length: Math.ceil(Math.max(...vals) / 60) - Math.floor(Math.min(...vals) / 60) + 1 }, (_, i) => (Math.floor(Math.min(...vals) / 60) + i) * 60)
    : undefined;
  return (
    <div className="space-y-2">
      <Legend items={[
        { label: "7-day average", color, shape: "line" },
        { label: "Each day", color: "var(--chart-ink)", shape: "dot" },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={MARGIN} onClick={onClick} style={{ cursor: hrefPrefix ? "pointer" : undefined }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {GRID}
          <XAxis dataKey="day" {...AXIS} tickFormatter={fmtDay} minTickGap={32} />
          <YAxis {...AXIS} axisLine={false} width={40} tickFormatter={(v) => fmtTick(v, format, digits)}
            domain={hourTicks ? [hourTicks[0], hourTicks.at(-1)!] : ["auto", "auto"]} ticks={hourTicks} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            content={({ active, payload }: TooltipContentProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { day: string; value: number | null; avg: number | null };
              return (
                <TooltipBox title={fmtDay(p.day)} hint={hrefPrefix ? "Click to open this day" : undefined} rows={[
                  ...(p.value != null ? [{ label, value: fmtValue(p.value, format, digits), color: "var(--chart-ink)" }] : []),
                  ...(p.avg != null ? [{ label: "7-day avg", value: fmtValue(p.avg, format, digits), color }] : []),
                ]} />
              );
            }}
          />
          {goal && <ReferenceLine y={goal} stroke="var(--muted-foreground)" strokeWidth={1}
            label={{ value: "goal", position: "insideTopLeft", fill: "var(--chart-ink)", fontSize: 10 }} />}
          <Area type="monotone" dataKey="avg" stroke="none" fill={`url(#${gid})`} connectNulls isAnimationActive={false} />
          <Scatter dataKey="value" fill="var(--chart-ink)" shape={(props: { cx?: number; cy?: number }) =>
            props.cx == null || props.cy == null ? <g /> : <circle cx={props.cx} cy={props.cy} r={2.25} fill="var(--chart-ink)" opacity={0.55} />} />
          <Line type="monotone" dataKey="avg" stroke={color} strokeWidth={2.25} dot={false} connectNulls
            activeDot={{ r: 4, fill: color, stroke: "var(--card)", strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny trend line for stat tiles. Last point marked. */
export function Sparkline({ values, color, height = 36 }: { values: (number | null)[]; color: string; height?: number }) {
  const gid = useId().replace(/:/g, "");
  const data = values.map((v, i) => ({ i, v }));
  const last = [...data].reverse().find((d) => d.v != null);
  if (data.filter((d) => d.v != null).length < 2) return <div style={{ height }} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 2, left: 4 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.75} fill={`url(#${gid})`} connectNulls
          isAnimationActive={false}
          dot={(p: { cx?: number; cy?: number; index?: number }) =>
            p.index === last?.i && p.cx != null && p.cy != null
              ? <circle key="last" cx={p.cx} cy={p.cy} r={3} fill={color} stroke="var(--card)" strokeWidth={1.5} />
              : <g key={p.index} />} />
      </AreaChart>
    </ResponsiveContainer>
  );
}


type SleepPoint = { day: string; deep: number; rem: number; light: number; awake: number; total_min: number };

export function SleepStages({ data, hrefPrefix, height = 220 }: { data: SleepPoint[]; hrefPrefix?: string; height?: number }) {
  const onClick = useDayClick(hrefPrefix);
  return (
    <div className="space-y-2">
      <Legend items={STAGES.map((s) => ({ label: s.label, color: s.color }))} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={MARGIN} onClick={onClick} style={{ cursor: hrefPrefix ? "pointer" : undefined }}>
          {GRID}
          <XAxis dataKey="day" {...AXIS} tickFormatter={fmtDay} minTickGap={20} />
          <YAxis {...AXIS} axisLine={false} width={40} tickFormatter={(v) => `${Math.round(v / 60)}h`} ticks={[0, 120, 240, 360, 480, 600]} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }: TooltipContentProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as SleepPoint;
              if (!p.total_min) return null;
              return (
                <TooltipBox title={`Night ending ${fmtDay(p.day)}`}
                  rows={STAGES.map((s) => ({ label: s.label, value: fmtMinutes(p[s.key]), color: s.color }))}
                  hint={hrefPrefix ? "Click to open this day" : undefined} />
              );
            }}
          />
          {STAGES.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} stackId="sleep" fill={s.color} maxBarSize={22}
              stroke="var(--card)" strokeWidth={1} radius={i === STAGES.length - 1 ? [4, 4, 0, 0] : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Heart rate through a day or a workout, with sleep / workout periods (or HR zones) shaded behind. */
export function IntradayHr({
  points, from, to, bands = [], zoneBands, height = 240, color = "var(--heart)",
}: {
  points: { t: number; bpm: number }[];
  from: number;
  to: number;
  bands?: { from: number; to: number; label: string; color: string }[];
  zoneBands?: { lo: number; hi: number; color: string }[];
  height?: number;
  color?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const hours = (to - from) / 3600000;
  const step = hours > 20 ? 3 : hours > 8 ? 2 : hours > 3 ? 1 : 0.25;
  const ticks: number[] = [];
  const first = new Date(from);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime(); t <= to; t += step * 3600000) if (t >= from) ticks.push(t);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={MARGIN}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {GRID}
        {zoneBands?.map((z, i) => (
          <ReferenceArea key={z.lo} y1={z.lo} y2={z.hi} fill={z.color} fillOpacity={0.1 + i * 0.03} stroke="none" ifOverflow="hidden"
            label={{ value: `Z${i + 1}`, position: "insideRight", fill: "var(--chart-ink)", fontSize: 11 }} />
        ))}
        {bands.map((b) => (
          <ReferenceArea key={b.from} x1={b.from} x2={b.to} fill={b.color} fillOpacity={0.1} stroke="none"
            label={{ value: b.label, position: "insideTop", fill: "var(--chart-ink)", fontSize: 11 }} />
        ))}
        <XAxis dataKey="t" type="number" domain={[from, to]} scale="time" {...AXIS} ticks={ticks} tickFormatter={fmtClock} />
        <YAxis {...AXIS} axisLine={false} width={36}
          domain={[(min: number) => Math.max(30, Math.floor(min / 10) * 10 - 10), (max: number) => Math.ceil(max / 10) * 10 + 5]} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { t: number; bpm: number };
            return <TooltipBox title={fmtClock(p.t)} rows={[{ label: "bpm", value: String(Math.round(p.bpm)), color }]} />;
          }}
        />
        <Area type="monotone" dataKey="bpm" stroke={color} strokeWidth={points.length > 600 ? 1.25 : 2} fill={`url(#${gid})`}
          isAnimationActive={false} activeDot={{ r: 4, fill: color, stroke: "var(--card)", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Daily heart-rate range (min to max as a band) with the daily resting value as a line. */
export function HeartRangeChart({ data, hrefPrefix, height = 240 }: {
  data: { day: string; range: [number, number] | null; resting: number | null }[]; hrefPrefix?: string; height?: number;
}) {
  const onClick = useDayClick(hrefPrefix);
  const vals = data.flatMap((d) => [...(d.range ?? []), d.resting]).filter((v): v is number => v != null);
  const lo = vals.length ? Math.max(30, Math.floor(Math.min(...vals) / 10) * 10 - 5) : 40;
  const hi = vals.length ? Math.ceil(Math.max(...vals) / 10) * 10 + 5 : 180;
  return (
    <div className="space-y-2">
      <Legend items={[
        { label: "Daily range (lowest to highest)", color: "color-mix(in oklab, var(--heart) 30%, transparent)" },
        { label: "Resting", color: "var(--heart)", shape: "line" },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={MARGIN} onClick={onClick} style={{ cursor: hrefPrefix ? "pointer" : undefined }}>
          {GRID}
          <XAxis dataKey="day" {...AXIS} tickFormatter={fmtDay} minTickGap={24} />
          <YAxis {...AXIS} axisLine={false} width={36} domain={[lo, hi]} allowDataOverflow />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={({ active, payload }: TooltipContentProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox title={fmtDay(p.day)} hint={hrefPrefix ? "Click to open this day" : undefined} rows={[
                  ...(p.range ? [{ label: "lowest", value: String(Math.round(p.range[0])) }, { label: "highest", value: String(Math.round(p.range[1])) }] : []),
                  ...(p.resting != null ? [{ label: "resting", value: String(Math.round(p.resting)), color: "var(--heart)" }] : []),
                ]} />
              );
            }}
          />
          <Bar dataKey="range" fill="var(--heart)" fillOpacity={0.22} radius={3} maxBarSize={10} isAnimationActive={false} />
          <Line type="monotone" dataKey="resting" stroke="var(--heart)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false}
            activeDot={{ r: 4, fill: "var(--heart)", stroke: "var(--card)", strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Sleep stages over the night: one lane per stage, deepest at the bottom. */
export function Hypnogram({ stages, from, to, compact = false }: {
  stages: { stage: string; start_ms: number; end_ms: number }[]; from: number; to: number; compact?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const lanes = ["awake", "rem", "light", "deep"] as const;
  const laneOf = (s: string) => (s === "out_of_bed" ? "awake" : s === "sleeping" ? "light" : s) as (typeof lanes)[number];
  const pct = (t: number) => ((t - from) / (to - from)) * 100;
  const color = (s: string) => STAGES.find((x) => x.key === laneOf(s))?.color ?? "var(--chart-axis)";
  const label = (s: string) => STAGES.find((x) => x.key === laneOf(s))?.label ?? s;
  const lane = compact ? 18 : 28;

  const ticks: number[] = [];
  const t0 = new Date(from);
  t0.setMinutes(0, 0, 0);
  const every = (to - from) / 3600000 > 6 ? 2 : 1;
  for (let t = t0.getTime() + 3600000; t < to; t += every * 3600000) ticks.push(t);

  const h = stages[hover ?? -1];
  return (
    <div className="flex gap-2 text-xs">
      <div className="flex w-11 flex-col text-right text-muted-foreground" style={{ paddingTop: 4 }}>
        {lanes.map((l) => <span key={l} style={{ height: lane, lineHeight: `${lane}px` }}>{label(l)}</span>)}
      </div>
      <div className="relative flex-1" onMouseLeave={() => setHover(null)}>
        <svg width="100%" height={4 * lane + 8} className="block">
          {lanes.map((l, i) => (
            <line key={l} x1="0" x2="100%" y1={4 + i * lane + lane / 2} y2={4 + i * lane + lane / 2} stroke="var(--chart-grid)" />
          ))}
          {stages.map((s, i) => {
            const li = lanes.indexOf(laneOf(s.stage));
            if (li < 0) return null;
            return (
              <rect key={i} x={`${pct(s.start_ms)}%`} width={`${Math.max(0.2, pct(s.end_ms) - pct(s.start_ms))}%`}
                y={4 + li * lane + 3} height={lane - 6} rx={3} fill={color(s.stage)}
                opacity={hover == null || hover === i ? 1 : 0.45} onMouseEnter={() => setHover(i)} />
            );
          })}
        </svg>
        <div className="relative h-4 text-muted-foreground">
          {ticks.map((t) => (
            <span key={t} className="tabular absolute -translate-x-1/2" style={{ left: `${pct(t)}%` }}>{fmtClock(t)}</span>
          ))}
        </div>
        {h && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full"
            style={{ left: `${Math.min(85, Math.max(15, pct((h.start_ms + h.end_ms) / 2)))}%` }}>
            <TooltipBox title={`${fmtClock(h.start_ms)} to ${fmtClock(h.end_ms)}`}
              rows={[{ label: label(h.stage), value: fmtMinutes((h.end_ms - h.start_ms) / 60000), color: color(h.stage) }]} />
          </div>
        )}
      </div>
    </div>
  );
}

const HEAT = ["var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

/** GitHub-style calendar of days, Monday-first weeks as columns; colour = quartile of the value. */
export function CalendarHeatmap({ days, label, hrefPrefix, goal }: {
  days: { day: string; value: number | null }[]; label: string; hrefPrefix?: string; goal?: number;
}) {
  const router = useRouter();
  const [hover, setHover] = useState<{ day: string; value: number | null; x: number; y: number } | null>(null);
  const vals = days.map((d) => d.value).filter((v): v is number => v != null).sort((a, b) => a - b);
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const bucket = (v: number) => (v < cuts[0] ? 0 : v < cuts[1] ? 1 : v < cuts[2] ? 2 : 3);

  const first = days[0] ? new Date(`${days[0].day}T12:00:00`) : new Date();
  const pad = (first.getDay() + 6) % 7;
  const cells = [...Array(pad).fill(null), ...days] as ({ day: string; value: number | null } | null)[];
  const weeks = Math.ceil(cells.length / 7);
  const months: { col: number; label: string }[] = [];
  cells.forEach((c, i) => {
    if (c && c.day.endsWith("-01")) months.push({ col: Math.floor(i / 7), label: new Date(`${c.day}T12:00:00`).toLocaleDateString(undefined, { month: "short" }) });
  });
  const show = (e: React.SyntheticEvent<HTMLElement>, c: { day: string; value: number | null }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const p = e.currentTarget.closest("[data-heatmap]")!.getBoundingClientRect();
    setHover({ ...c, x: r.left - p.left + r.width / 2, y: r.top - p.top });
  };

  return (
    <div data-heatmap className="relative" onMouseLeave={() => setHover(null)}>
      <div className="overflow-x-auto pb-1">
        <div className="inline-grid gap-[3px] pl-8" style={{ gridTemplateColumns: `repeat(${weeks}, 13px)` }}>
          {months.map((m) => (
            <span key={m.col} className="text-[10px] text-muted-foreground" style={{ gridColumn: m.col + 1, gridRow: 1 }}>{m.label}</span>
          ))}
        </div>
        <div className="flex">
          <div className="grid w-8 shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-[13px] text-muted-foreground">
            {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="inline-grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: `repeat(${weeks}, 13px)` }}>
            {cells.map((c, i) =>
              c ? (
                <button key={c.day} type="button" aria-label={`${c.day}: ${c.value ?? "no data"} ${label}`}
                  className="size-[13px] rounded-[3px] outline-offset-1 transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-ring"
                  style={{
                    background: c.value == null ? "var(--muted)" : HEAT[bucket(c.value)],
                    boxShadow: goal && c.value != null && c.value >= goal ? "inset 0 0 0 1.5px var(--foreground)" : undefined,
                  }}
                  onMouseEnter={(e) => show(e, c)} onFocus={(e) => show(e, c)}
                  onClick={() => hrefPrefix && router.push(`${hrefPrefix}${c.day}`)} />
              ) : <span key={`pad${i}`} />,
            )}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1 pl-8 text-[11px] text-muted-foreground">
        Fewer {HEAT.map((c) => <span key={c} className="inline-block size-[11px] rounded-[3px]" style={{ background: c }} />)} More
        {goal && <span className="ml-3 inline-flex items-center gap-1"><span className="inline-block size-[11px] rounded-[3px] bg-muted shadow-[inset_0_0_0_1.5px_var(--foreground)]" /> Goal met</span>}
        <span className="ml-3 inline-flex items-center gap-1"><span className="inline-block size-[11px] rounded-[3px] bg-muted" /> No data</span>
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full" style={{ left: hover.x, top: hover.y - 6 }}>
          <TooltipBox title={fmtPeriod(hover.day, "day")}
            rows={[{ label, value: hover.value == null ? "No data" : fmtNum(hover.value), color: hover.value == null ? undefined : "var(--activity)" }]} />
        </div>
      )}
    </div>
  );
}

/** One bar per night from bedtime to wake time, so drift and irregularity are visible. */
export function BedWakeChart({ data, hrefPrefix, height = 260 }: {
  data: { day: string; range: [number, number] | null; asleep: number | null }[]; hrefPrefix?: string; height?: number;
}) {
  const onClick = useDayClick(hrefPrefix);
  const all = data.flatMap((d) => d.range ?? []);
  const lo = all.length ? Math.floor((Math.min(...all) - 30) / 60) * 60 : 180;
  const hi = all.length ? Math.ceil((Math.max(...all) + 30) / 60) * 60 : 900;
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += 120) ticks.push(t);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={MARGIN} onClick={onClick} style={{ cursor: hrefPrefix ? "pointer" : undefined }}>
        {GRID}
        <XAxis dataKey="day" {...AXIS} tickFormatter={fmtDay} minTickGap={20} />
        <YAxis {...AXIS} axisLine={false} width={44} reversed domain={[lo, hi]} ticks={ticks} tickFormatter={fmtTimeOfNight} />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.6 }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as (typeof data)[number];
            if (!p.range) return null;
            return (
              <TooltipBox title={`Night ending ${fmtDay(p.day)}`} hint={hrefPrefix ? "Click to open this day" : undefined} rows={[
                { label: "fell asleep", value: fmtTimeOfNight(p.range[0]) },
                { label: "woke up", value: fmtTimeOfNight(p.range[1]) },
                ...(p.asleep != null ? [{ label: "asleep", value: fmtMinutes(p.asleep), color: "var(--sleep)" }] : []),
              ]} />
            );
          }}
        />
        <Bar dataKey="range" fill="var(--sleep)" radius={6} maxBarSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}


/** Time spent in each heart-rate zone, as labelled horizontal bars. */
export function ZoneBars({ seconds, zones }: {
  seconds: number[]; zones: { label: string; name: string; range: string }[];
}) {
  const total = seconds.reduce((a, b) => a + b, 0);
  const max = Math.max(...seconds, 1);
  return (
    <div className="space-y-3 text-xs">
      {zones.map((z, i) => (
        <div key={z.label} className="grid grid-cols-[8.75rem_1fr_auto] items-center gap-3">
          <div className="leading-tight">
            <div className="font-medium">{z.name}</div>
            <div className="text-muted-foreground">{z.label} · {z.range}</div>
          </div>
          <div className="h-2.5">
            <div className="h-2.5 rounded-full" style={{ width: `${Math.max(1.5, (seconds[i] / max) * 100)}%`, background: ZONE_COLORS[i] }} />
          </div>
          <div className="tabular min-w-[4.75rem] whitespace-nowrap text-right">
            <span className="font-semibold">{fmtMinutes(seconds[i] / 60)}</span>
            <span className="ml-1 text-muted-foreground">{total ? Math.round((seconds[i] / total) * 100) : 0}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Plain line chart for a single daily series (vitals with sparse readings). */
export function DailyLine({ data, label, color, digits = 0, hrefPrefix, height = 200 }: {
  data: Point[]; label: string; color: string; digits?: number; hrefPrefix?: string; height?: number;
}) {
  const onClick = useDayClick(hrefPrefix);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={MARGIN} onClick={onClick} style={{ cursor: hrefPrefix ? "pointer" : undefined }}>
        {GRID}
        <XAxis dataKey="day" {...AXIS} tickFormatter={fmtDay} minTickGap={24} />
        <YAxis {...AXIS} axisLine={false} width={40} domain={["auto", "auto"]} tickFormatter={(v) => fmtNum(v, digits)} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length || payload[0].value == null) return null;
            const p = payload[0].payload as Point;
            return <TooltipBox title={fmtDay(p.day)} rows={[{ label, value: fmtNum(Number(p.value), digits), color }]} />;
          }}
        />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} connectNulls
          dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: 4, fill: color, stroke: "var(--card)", strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Strain accumulating through the day, with workouts shaded, against the strain bands. */
export function StrainBuild({ points, from, to, bands = [], target, height = 220 }: {
  points: { t: number; strain: number }[];
  from: number;
  to: number;
  bands?: { from: number; to: number; label: string }[];
  target?: [number, number] | null;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  const color = "var(--strain)";
  const ticks: number[] = [];
  const first = new Date(from);
  first.setMinutes(0, 0, 0);
  for (let t = first.getTime(); t <= to; t += 3 * 3600000) if (t >= from) ticks.push(t);
  const top = Math.max(60, Math.ceil(Math.max(...points.map((p) => p.strain), target?.[1] ?? 0) / 20) * 20);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={MARGIN}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {GRID}
        {target && (
          <ReferenceArea y1={target[0]} y2={target[1]} fill={color} fillOpacity={0.08} stroke="none" ifOverflow="hidden"
            label={{ value: "Target", position: "insideTopLeft", fill: "var(--chart-ink)", fontSize: 11 }} />
        )}
        {bands.map((b) => (
          <ReferenceArea key={b.from} x1={b.from} x2={b.to} fill="var(--exercise)" fillOpacity={0.12} stroke="none" />
        ))}
        <XAxis dataKey="t" type="number" domain={[from, to]} scale="time" {...AXIS} ticks={ticks} tickFormatter={fmtClock} />
        <YAxis {...AXIS} axisLine={false} width={36} domain={[0, top]} ticks={[0, 30, 55, 80].filter((v) => v <= top)} />
        <Tooltip
          cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
          content={({ active, payload }: TooltipContentProps) => {
            if (!active || !payload?.length) return null;
            const p = payload[0].payload as { t: number; strain: number };
            const inWorkout = bands.find((b) => p.t >= b.from && p.t <= b.to);
            return <TooltipBox title={fmtClock(p.t)} hint={inWorkout ? titleCase(inWorkout.label) : undefined}
              rows={[{ label: "strain so far", value: String(Math.round(p.strain)), color }]} />;
          }}
        />
        <Area type="stepAfter" dataKey="strain" stroke={color} strokeWidth={2} fill={`url(#${gid})`}
          isAnimationActive={false} activeDot={{ r: 4, fill: color, stroke: "var(--card)", strokeWidth: 2 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Pace (faster is higher) and heart rate along a run, by distance. */
export function PaceChart({ data, height = 260 }: {
  data: { km: number; t: number; pace: number | null; hr: number | null }[]; height?: number;
}) {
  const paces = data.map((p) => p.pace).filter((v): v is number => v != null).sort((a, b) => a - b);
  // Scale to the bulk of the run, so a walk break doesn't squash everything else
  const lo = paces.length ? Math.floor(paces[0] / 30) * 30 : 300;
  const hi = paces.length ? Math.ceil(paces[Math.floor(paces.length * 0.95)] / 30) * 30 + 30 : 600;
  const step = hi - lo > 300 ? 60 : 30;
  const paceTicks = Array.from({ length: Math.floor((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const hrs = data.map((p) => p.hr).filter((v): v is number => v != null);
  const total = data.at(-1)?.km ?? 1;
  return (
    <div className="space-y-2">
      <Legend items={[
        { label: "Pace (30 s average)", color: "var(--exercise)", shape: "line" },
        { label: "Heart rate", color: "var(--heart)", shape: "line" },
      ]} />
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ ...MARGIN, right: 0 }}>
          {GRID}
          <XAxis dataKey="km" type="number" domain={[0, total]} {...AXIS} tickFormatter={(v: number) => `${v.toFixed(v % 1 ? 1 : 0)} km`}
            ticks={Array.from({ length: Math.floor(total) + 1 }, (_, i) => i)} />
          <YAxis yAxisId="pace" {...AXIS} axisLine={false} width={40} reversed domain={[lo, hi]} ticks={paceTicks} allowDataOverflow
            tickFormatter={(v: number) => fmtPaceSec(v)} />
          <YAxis yAxisId="hr" orientation="right" {...AXIS} axisLine={false} width={32}
            domain={hrs.length ? [Math.floor(Math.min(...hrs) / 10) * 10 - 10, Math.ceil(Math.max(...hrs) / 10) * 10] : ["auto", "auto"]} />
          <Tooltip
            cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
            content={({ active, payload }: TooltipContentProps) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof data)[number];
              return (
                <TooltipBox title={`${p.km.toFixed(2)} km · ${fmtClock(p.t)}`} rows={[
                  { label: "/km", value: p.pace != null ? fmtPaceSec(p.pace) : "stopped", color: "var(--exercise)" },
                  ...(p.hr != null ? [{ label: "bpm", value: String(Math.round(p.hr)), color: "var(--heart)" }] : []),
                ]} />
              );
            }}
          />
          <Line yAxisId="hr" type="monotone" dataKey="hr" stroke="var(--heart)" strokeWidth={1.5} strokeOpacity={0.7} dot={false}
            connectNulls isAnimationActive={false} />
          <Line yAxisId="pace" type="monotone" dataKey="pace" stroke="var(--exercise)" strokeWidth={2.25} dot={false}
            isAnimationActive={false} activeDot={{ r: 4, fill: "var(--exercise)", stroke: "var(--card)", strokeWidth: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
