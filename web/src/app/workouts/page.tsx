import { Activity, Clock, Dumbbell, Gauge, ListOrdered, Route, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DailyColumns, ZoneBars } from "@/components/dash/charts";
import { EmptyHint, IconChip, Panel, SegmentedLinks, StatTile } from "@/components/dash/primitives";
import { PageBody, PageHeader } from "@/components/page-header";
import {
  baselineRestingHr, bucketAvg, dayStartMs, localDay, maxHeartRate, personalBests, shiftDay, todayLocal, trainingLoad,
  weeklyLoad, workoutsBetween, workoutsWithZones, zoneLabels,
} from "@/lib/analytics";
import { fmtDay, fmtMinutes, fmtNum, fmtPace, titleCase } from "@/lib/format";
import { listDays } from "@/lib/queries";

export const metadata: Metadata = { title: "Workouts" };

const RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "3 months" },
  { value: "182", label: "6 months" },
  { value: "365", label: "1 year" },
];

export default async function WorkoutsPage({ searchParams }: PageProps<"/workouts">) {
  await connection();
  const sp = await searchParams;
  const rangeKey = RANGES.find((r) => r.value === sp.range)?.value ?? "90";
  const showAuto = sp.auto === "1";
  const href = (o: { range?: string; auto?: boolean }) => `/workouts?range=${o.range ?? rangeKey}${(o.auto ?? showAuto) ? "&auto=1" : ""}`;
  const today = todayLocal();
  const range = { from: shiftDay(today, -(Number(rangeKey) - 1)), to: today };

  const max = maxHeartRate();
  const restHr = baselineRestingHr();
  const { workouts, totals } = workoutsWithZones(dayStartMs(range.from), dayStartMs(shiftDay(today, 1)), max.value, showAuto);
  const autoCount = showAuto ? workouts.filter((w) => w.auto).length
    : workoutsBetween(dayStartMs(range.from), dayStartMs(shiftDay(today, 1))).filter((w) => w.auto).length;
  const loads = new Map(workouts.map((w) => [w.uid, trainingLoad(w, max.value, restHr)]));
  const weeks = weeklyLoad(workouts, max.value, restHr);
  const weekKeys = bucketAvg(listDays(range).map((day) => ({ day, value: 0 })), "week").map((w) => w.day);
  const totalMin = workouts.reduce((a, w) => a + (w.end_ms - w.start_ms) / 60000, 0);
  const totalKm = workouts.reduce((a, w) => a + (w.distance_m ?? 0), 0) / 1000;
  const totalLoad = [...loads.values()].reduce<number>((a, l) => a + (l ?? 0), 0);
  const nWeeks = Math.max(1, Number(rangeKey) / 7);

  const byType = new Map<string, { count: number; min: number; km: number; hr: number[]; load: number }>();
  for (const w of workouts) {
    const t = byType.get(w.type) ?? { count: 0, min: 0, km: 0, hr: [], load: 0 };
    t.count++;
    t.min += (w.end_ms - w.start_ms) / 60000;
    t.km += (w.distance_m ?? 0) / 1000;
    if (w.avg_hr) t.hr.push(w.avg_hr);
    t.load += loads.get(w.uid) ?? 0;
    byType.set(w.type, t);
  }
  const types = [...byType.entries()].sort((a, b) => b[1].min - a[1].min);
  const maxTypeMin = Math.max(...types.map(([, t]) => t.min), 1);

  return (
    <>
      <PageHeader title="Workouts" subtitle="Training volume, intensity and personal bests">
        <SegmentedLinks options={[{ value: "0", label: "Workouts" }, { value: "1", label: "Include auto-detected" }]}
          current={showAuto ? "1" : "0"} href={(v) => href({ auto: v === "1" })} />
        <SegmentedLinks options={RANGES} current={rangeKey} href={(v) => href({ range: v })} />
      </PageHeader>
      <PageBody>
        {autoCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {showAuto
              ? `Including ${autoCount} walks and activities your watch detected automatically.`
              : `${autoCount} walks and activities your watch detected automatically are hidden. They still count towards your exercise minutes and Activity score.`}
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Workouts" icon={Dumbbell} domain="exercise" value={workouts.length}
            footer={<span className="text-xs text-muted-foreground">{(workouts.length / nWeeks).toFixed(1)} a week</span>} />
          <StatTile label="Time training" icon={Clock} domain="exercise" value={fmtMinutes(totalMin)}
            footer={<span className="text-xs text-muted-foreground">{fmtMinutes(totalMin / nWeeks)} a week</span>} />
          <StatTile label="Distance" icon={Route} domain="exercise" value={totalKm.toFixed(1)} unit="km"
            footer={<span className="text-xs text-muted-foreground">{(totalKm / nWeeks).toFixed(1)} km a week</span>} />
          <StatTile label="Training load" icon={Gauge} domain="exercise" value={fmtNum(totalLoad)}
            footer={<span className="text-xs text-muted-foreground">{fmtNum(totalLoad / nWeeks)} a week</span>} />
        </div>

        {workouts.length === 0 ? <EmptyHint icon={Dumbbell} title="No workouts in this period">Start a workout on your watch and it will show up here after the next sync.</EmptyHint> : (
          <>
            <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <Panel title="Weekly training load" icon={Gauge} domain="exercise"
                description="Minutes of exercise weighted by how hard your heart worked (TRIMP), so hard sessions count for more">
                <DailyColumns period="week" label="load" color="var(--exercise)" height={240}
                  data={weekKeys.map((day) => ({ day, value: Math.round(weeks.get(day)?.load ?? 0) }))} />
              </Panel>
              <Panel title="Time in heart-rate zones" icon={Activity} domain="heart"
                description={`All workouts in this period. Zones use a max heart rate of ${max.value} bpm (${max.source === "env" ? "set with MAX_HR" : max.source === "observed" ? "your highest recorded; override with MAX_HR" : "default; set MAX_HR"}).`}>
                {totals.some((s) => s > 0) ? <ZoneBars seconds={totals} zones={zoneLabels(max.value)} />
                  : <EmptyHint icon={Activity} title="No heart-rate readings during workouts" />}
              </Panel>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="By activity" icon={Dumbbell} domain="exercise">
                <ul className="space-y-3">
                  {types.map(([type, t]) => (
                    <li key={type} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium">{titleCase(type)} <span className="font-normal text-muted-foreground">· {t.count}×</span></span>
                        <span className="tabular text-xs text-muted-foreground">
                          {[fmtMinutes(t.min), t.km ? `${t.km.toFixed(1)} km` : null, t.hr.length ? `avg ${Math.round(t.hr.reduce((a, b) => a + b, 0) / t.hr.length)} bpm` : null].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-exercise" style={{ width: `${(t.min / maxTypeMin) * 100}%`, opacity: 0.4 + 0.6 * (t.min / maxTypeMin) }} />
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Personal bests" icon={Trophy} domain="exercise" description="All time">
                <div className="grid gap-2 sm:grid-cols-2">
                  {personalBests().map((b) => {
                    const inner = (
                      <>
                        <div className="text-xs text-muted-foreground">{b.label}</div>
                        <div className="tabular mt-0.5 text-base font-semibold">{b.value ?? "-"}</div>
                        <div className="text-xs text-muted-foreground">
                          {typeof b.when === "number" ? fmtDay(localDay(b.when)) : b.when ? fmtDay(b.when) : "No data yet"}
                        </div>
                      </>
                    );
                    return b.href
                      ? <Link key={b.label} href={b.href} className="rounded-xl bg-muted/60 p-3 transition-colors hover:bg-muted">{inner}</Link>
                      : <div key={b.label} className="rounded-xl bg-muted/60 p-3">{inner}</div>;
                  })}
                </div>
              </Panel>
            </div>

            <Panel title="All workouts" icon={ListOrdered} domain="exercise" description="Click one for its heart-rate curve and zones">
              <ul className="-mx-2 max-h-[34rem] divide-y overflow-auto">
                {workouts.map((w) => {
                  const load = loads.get(w.uid);
                  return (
                    <li key={w.uid}>
                      <Link href={`/workouts/${encodeURIComponent(w.uid)}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted">
                        <IconChip icon={Dumbbell} domain="exercise" size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{w.title ?? titleCase(w.type)}
                            {w.auto ? <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">auto</span> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">{fmtDay(localDay(w.start_ms))}</div>
                        </div>
                        <div className="tabular hidden w-20 text-right text-sm sm:block">{fmtMinutes((w.end_ms - w.start_ms) / 60000)}</div>
                        <div className="tabular hidden w-24 text-right text-sm md:block">{w.distance_m ? `${(w.distance_m / 1000).toFixed(2)} km` : ""}</div>
                        <div className="tabular hidden w-24 text-right text-xs text-muted-foreground lg:block">{w.distance_m && w.distance_m > 500 ? fmtPace(w.end_ms - w.start_ms, w.distance_m) : ""}</div>
                        <div className="w-16 text-right">
                          <div className="tabular text-sm font-semibold">{w.avg_hr ? Math.round(w.avg_hr) : "-"}</div>
                          <div className="text-[11px] text-muted-foreground">avg bpm</div>
                        </div>
                        <div className="w-14 text-right">
                          <div className="tabular text-sm font-semibold">{load ? Math.round(load) : "-"}</div>
                          <div className="text-[11px] text-muted-foreground">load</div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </>
        )}
      </PageBody>
    </>
  );
}
