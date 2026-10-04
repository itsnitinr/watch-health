import { BedDouble, CalendarRange, Dumbbell, Footprints, HeartPulse, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { DailyColumns, DailyLine } from "@/components/dash/charts";
import { DOMAIN, Delta, EmptyHint, Panel, StatTile, type Domain } from "@/components/dash/primitives";
import { PageBody, PageHeader } from "@/components/page-header";
import {
  baselineRestingHr, dataExtent, dayStartMs, localDay, maxHeartRate, nights, restingHeartRate, shiftDay, todayLocal,
  trainingLoad, workoutsBetween,
} from "@/lib/analytics";
import { fmtLongDay, fmtMinutes, fmtNum, fmtPeriod } from "@/lib/format";
import { dailyMetric, dailySampleStats, type Range } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Trends" };

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const monthOf = (day: string) => `${day.slice(0, 7)}-01`;
const inRange = (day: string, r: Range) => day >= r.from && day <= r.to;

type Month = {
  day: string; days: number; partial: boolean;
  steps: number | null; asleep: number | null; sleepScore: number | null; rhr: number | null;
  workouts: number; workoutMinPerWeek: number; vo2: number | null;
};

type Column = {
  key: keyof Month; label: string; domain: Domain; lowerIsBetter?: boolean;
  format: (v: number) => string;
};

const COLUMNS: Column[] = [
  { key: "steps", label: "Steps / day", domain: "activity", format: (v) => fmtNum(v) },
  { key: "asleep", label: "Asleep / night", domain: "sleep", format: fmtMinutes },
  { key: "sleepScore", label: "Sleep score", domain: "sleep", format: (v) => fmtNum(v) },
  { key: "rhr", label: "Resting HR", domain: "heart", lowerIsBetter: true, format: (v) => `${fmtNum(v)} bpm` },
  { key: "workouts", label: "Workouts", domain: "exercise", format: (v) => fmtNum(v) },
  { key: "workoutMinPerWeek", label: "Workout time / week", domain: "exercise", format: fmtMinutes },
  { key: "vo2", label: "VO2 max", domain: "heart", format: (v) => fmtNum(v, 1) },
];

export default async function TrendsPage() {
  await connection();
  const today = todayLocal();
  const extent = dataExtent();
  if (!extent) {
    return (
      <>
        <PageHeader title="Trends" subtitle="How your months compare" />
        <PageBody><EmptyHint icon={CalendarRange} title="No data yet">Sync from the phone app to see your trends.</EmptyHint></PageBody>
      </>
    );
  }
  const all: Range = { from: extent.first, to: today };

  const steps = dailyMetric("steps", all);
  const sleep = nights(all);
  const rhr = restingHeartRate(all);
  const vo2 = dailySampleStats("vo2_max", all).map((r) => ({ day: r.day, value: r.avg }));
  // Auto-detected walks are left out, as on the Workouts page; they'd swamp the counts.
  const max = maxHeartRate();
  const restHr = baselineRestingHr();
  const workouts = workoutsBetween(dayStartMs(all.from), dayStartMs(shiftDay(today, 1)), { includeAuto: false })
    .map((w) => ({ day: localDay(w.start_ms), minutes: (w.end_ms - w.start_ms) / 60000, load: trainingLoad(w, max.value, restHr) }));

  // ----- Last 30 days against the 30 before, and the same 30 days a year earlier
  const last30: Range = { from: shiftDay(today, -29), to: today };
  const prev30: Range = { from: shiftDay(today, -59), to: shiftDay(today, -30) };
  const yearAgo: Range = { from: shiftDay(last30.from, -365), to: shiftDay(today, -365) };
  const covered = (r: Range) => extent.first <= r.from;
  const windowStats = (r: Range) => ({
    steps: mean(steps.filter((s) => inRange(s.day, r)).map((s) => s.value)),
    asleep: mean(sleep.filter((n) => inRange(n.day, r)).map((n) => n.asleep)),
    rhr: mean(rhr.filter((x) => inRange(x.day, r)).map((x) => x.value)),
    workoutMin: covered(r) || r === last30 ? sum(workouts.filter((w) => inRange(w.day, r)).map((w) => w.minutes)) / (30 / 7) : null,
  });
  const now = windowStats(last30);
  const before = covered(prev30) ? windowStats(prev30) : null;
  const lastYear = covered(yearAgo) ? windowStats(yearAgo) : null;

  // ----- Month by month
  const byMonth = <T extends { day: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(monthOf(r.day), [...(m.get(monthOf(r.day)) ?? []), r]);
    return m;
  };
  const stepsM = byMonth(steps), sleepM = byMonth(sleep), rhrM = byMonth(rhr), vo2M = byMonth(vo2), workoutsM = byMonth(workouts);
  const months: Month[] = [];
  for (let d = monthOf(extent.first); d <= today; d = monthOf(shiftDay(d, 32))) {
    const lastDay = shiftDay(monthOf(shiftDay(d, 32)), -1);
    const first = d < extent.first ? extent.first : d;
    const last = lastDay > today ? today : lastDay;
    const days = Math.round((dayStartMs(last) - dayStartMs(first)) / 86400000) + 1;
    const ws = workoutsM.get(d) ?? [];
    months.push({
      day: d, days, partial: last !== lastDay || first !== d,
      steps: mean((stepsM.get(d) ?? []).map((s) => s.value)),
      asleep: mean((sleepM.get(d) ?? []).map((n) => n.asleep)),
      sleepScore: mean((sleepM.get(d) ?? []).map((n) => n.score)),
      rhr: mean((rhrM.get(d) ?? []).map((x) => x.value)),
      workouts: ws.length,
      workoutMinPerWeek: sum(ws.map((w) => w.minutes)) / (days / 7),
      vo2: mean((vo2M.get(d) ?? []).map((x) => x.value)),
    });
  }
  const series = (key: keyof Month) => months.map((m) => ({ day: m.day, value: m[key] as number | null }));

  // Shade each cell by how good that month was for its column, from palest (worst) to strongest (best)
  const ranges = new Map(COLUMNS.map((c) => {
    const vs = months.map((m) => m[c.key] as number | null).filter((v): v is number => v != null);
    return [c.key, vs.length ? [Math.min(...vs), Math.max(...vs)] as const : null];
  }));
  const shade = (c: Column, v: number) => {
    const r = ranges.get(c.key);
    if (!r || r[1] === r[0]) return undefined;
    let t = (v - r[0]) / (r[1] - r[0]);
    if (c.lowerIsBetter) t = 1 - t;
    return { background: `color-mix(in oklab, ${DOMAIN[c.domain].color} ${Math.round(4 + t * 26)}%, transparent)` };
  };

  const tile = (label: string, icon: LucideIcon, domain: Domain, value: number | null, display: (v: number) => string, unit: string,
    pick: (w: ReturnType<typeof windowStats>) => number | null, upIsGood: boolean, fmtDiff: (d: number) => string) => (
    <StatTile label={label} icon={icon} domain={domain} value={value != null ? display(value) : "-"} unit={unit}
      footer={
        <div className="flex flex-col gap-0.5">
          {before && <Delta value={value} reference={pick(before)} upIsGood={upIsGood} format={fmtDiff} suffix="vs previous 30 days" />}
          {lastYear && <Delta value={value} reference={pick(lastYear)} upIsGood={upIsGood} format={fmtDiff} suffix="vs a year ago" />}
        </div>
      } />
  );

  return (
    <>
      <PageHeader title="Trends" subtitle={`How your months compare, since ${fmtPeriod(extent.first, "month")}`} />
      <PageBody>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {tile("Steps, last 30 days", Footprints, "activity", now.steps, (v) => fmtNum(v), "/ day", (w) => w.steps, true, (d) => fmtNum(d))}
          {tile("Sleep, last 30 days", BedDouble, "sleep", now.asleep, fmtMinutes, "/ night", (w) => w.asleep, true, fmtMinutes)}
          {tile("Resting HR, last 30 days", HeartPulse, "heart", now.rhr, (v) => fmtNum(v), "bpm", (w) => w.rhr, false, (d) => `${fmtNum(d, 1)} bpm`)}
          {tile("Workouts, last 30 days", Dumbbell, "exercise", now.workoutMin, fmtMinutes, "/ week", (w) => w.workoutMin, true, fmtMinutes)}
        </div>
        {!lastYear && (
          <p className="text-xs text-muted-foreground">
            Comparisons with a year ago start on {fmtLongDay(shiftDay(extent.first, 365 + 29))}, once there&apos;s a full year of history.
          </p>
        )}

        <Panel title="Month by month" icon={CalendarRange}
          description="Averages per day or night within each month. The stronger the colour, the better that month was for that column.">
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  {COLUMNS.map((c) => <th key={c.key} className="px-2 py-2 text-right font-medium">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...months].reverse().map((m) => (
                  <tr key={m.day} className="border-t">
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      <span className="font-medium">{fmtPeriod(m.day, "month")}</span>
                      {m.partial && <span className="ml-1.5 text-xs text-muted-foreground">{m.days} {m.days === 1 ? "day" : "days"}</span>}
                    </td>
                    {COLUMNS.map((c) => {
                      const v = m[c.key] as number | null;
                      return (
                        <td key={c.key} className="tabular px-1 py-1 text-right">
                          <span className={cn("block rounded-md px-1.5 py-1", v == null && "text-muted-foreground")}
                            style={v != null ? shade(c, v) : undefined}>
                            {v != null && !(c.key === "workouts" && v === 0) ? c.format(v) : "-"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Steps per day" icon={Footprints} domain="activity" description="Monthly average">
            <DailyColumns data={series("steps")} label="steps / day" color="var(--activity)" period="month" />
          </Panel>
          <Panel title="Time asleep" icon={BedDouble} domain="sleep" description="Monthly average per night">
            <DailyColumns data={series("asleep")} label="asleep" color="var(--sleep)" period="month" format="minutes" />
          </Panel>
          <Panel title="Resting heart rate" icon={HeartPulse} domain="heart" description="Monthly average. Lower usually means better fitness and recovery.">
            <DailyLine data={series("rhr")} label="bpm" color="var(--heart)" period="month" />
          </Panel>
          <Panel title="Workout time per week" icon={Dumbbell} domain="exercise" description="Monthly average, not counting walks the watch detected on its own">
            <DailyColumns data={series("workoutMinPerWeek")} label="per week" color="var(--exercise)" period="month" format="minutes" />
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
