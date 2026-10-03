import { Activity, ArrowLeft, Clock, Dumbbell, Flame, Gauge, HeartPulse, History, Route } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { IntradayHr, ZoneBars } from "@/components/dash/charts";
import { RunPanels } from "@/components/dash/run";
import { ZONE_COLORS } from "@/lib/palette";
import { EmptyHint, Panel, StatTile } from "@/components/dash/primitives";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  ZONES, baselineRestingHr, intradayHeartRate, localDay, maxHeartRate, timeInZones, trainingLoad, workout, zoneLabels,
} from "@/lib/analytics";
import { getDb } from "@/lib/db";
import { fmtClock, fmtDay, fmtLongDay, fmtMinutes, fmtNum, fmtPace, titleCase } from "@/lib/format";
import { runDetail } from "@/lib/run";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Workout" };

export default async function WorkoutPage({ params }: PageProps<"/workouts/[id]">) {
  await connection();
  const { id } = await params;
  const w = workout(decodeURIComponent(id));
  if (!w) notFound();

  const max = maxHeartRate();
  const restHr = baselineRestingHr();
  const hr = intradayHeartRate(w.start_ms, w.end_ms);
  const zones = timeInZones(hr, w.end_ms, max.value);
  const load = trainingLoad(w, max.value, restHr);
  const durationMs = w.end_ms - w.start_ms;
  const day = localDay(w.start_ms);
  const isDistance = !!w.distance_m && w.distance_m > 500;
  const run = isDistance ? runDetail(w, hr) : null;
  const name = w.title ?? titleCase(w.type);

  // Other sessions of the same activity, for context
  const similar = getDb()
    .prepare(`SELECT uid, type, title, start_ms, end_ms, kcal, distance_m, avg_hr, max_hr FROM exercise_sessions
              WHERE type = ? ORDER BY start_ms DESC LIMIT 200`)
    .all(w.type).map((r) => ({ ...r })) as unknown as NonNullable<ReturnType<typeof workout>>[];
  const others = similar.filter((x) => x.uid !== w.uid);
  const avgOf = (f: (x: (typeof similar)[number]) => number | null) => {
    const v = others.map(f).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const typical = {
    min: avgOf((x) => (x.end_ms - x.start_ms) / 60000),
    hr: avgOf((x) => x.avg_hr),
    load: avgOf((x) => trainingLoad(x, max.value, restHr)),
    km: avgOf((x) => (x.distance_m ? x.distance_m / 1000 : null)),
  };
  const vs = (t: number | null, f: (x: number) => string) =>
    t != null && others.length >= 2 ? <span className="text-xs text-muted-foreground">Your usual {f(t)}</span> : null;
  const recent = similar.filter((x) => x.start_ms <= w.start_ms).slice(0, 8);
  const topZone = zones.indexOf(Math.max(...zones));

  return (
    <>
      <PageHeader title={name} subtitle={`${fmtLongDay(day)}, ${fmtClock(w.start_ms)} to ${fmtClock(w.end_ms)}`}>
        <Button variant="outline" size="sm" asChild><Link href={`/day/${day}`}>Open day</Link></Button>
        <Button variant="ghost" size="sm" asChild><Link href="/workouts"><ArrowLeft />Workouts</Link></Button>
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Duration" icon={Clock} domain="exercise" value={fmtMinutes(durationMs / 60000)}
            footer={vs(typical.min, (x) => `${Math.round(x)} min`)} />
          {isDistance ? (
            <StatTile label="Distance" icon={Route} domain="exercise" value={(w.distance_m! / 1000).toFixed(2)} unit="km"
              footer={<span className="text-xs text-muted-foreground">{fmtPace(durationMs, w.distance_m!)}{w.kcal ? ` · ${fmtNum(w.kcal)} kcal` : ""}</span>} />
          ) : (
            <StatTile label="Calories" icon={Flame} domain="exercise" value={w.kcal ? fmtNum(w.kcal) : "-"} unit="kcal" />
          )}
          <StatTile label="Average heart rate" icon={HeartPulse} domain="heart" value={w.avg_hr ? Math.round(w.avg_hr) : "-"} unit="bpm"
            footer={<span className="text-xs text-muted-foreground">{w.max_hr ? `max ${Math.round(w.max_hr)}` : ""}{typical.hr != null && others.length >= 2 ? ` · usual ${Math.round(typical.hr)}` : ""}</span>} />
          <StatTile label="Training load" icon={Gauge} domain="exercise" value={load != null ? Math.round(load) : "-"}
            footer={vs(typical.load, (x) => `${Math.round(x)}`)} />
        </div>

        {run && <RunPanels run={run} />}

        <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
          <Panel title="Heart rate" icon={HeartPulse} domain="heart" description="Shaded bands are your heart-rate zones">
            {hr.length > 1 ? (
              <IntradayHr points={hr} from={w.start_ms} to={w.end_ms} height={300}
                zoneBands={ZONES.map((z, i) => ({
                  lo: Math.round(z.lo * max.value),
                  hi: z.hi === Infinity ? 250 : Math.round(z.hi * max.value),
                  color: ZONE_COLORS[i],
                }))} />
            ) : <EmptyHint icon={HeartPulse} title="No detailed heart-rate readings for this workout" />}
          </Panel>
          <Panel title="Time in zones" icon={Activity} domain="heart"
            description={hr.length > 1 ? `Mostly ${ZONES[topZone].name.toLowerCase()} (${ZONES[topZone].label}). Max HR ${max.value} bpm.` : undefined}>
            {hr.length > 1 ? <ZoneBars seconds={zones} zones={zoneLabels(max.value)} /> : <EmptyHint icon={Activity} title="No zone data" />}
          </Panel>
        </div>

        {recent.length > 1 && (
          <Panel title={`Recent ${titleCase(w.type).toLowerCase()} sessions`} icon={History} domain="exercise" description="This workout and the ones before it">
            <div className="overflow-x-auto">
              <table className="tabular w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>{["Date", "Duration", ...(typical.km != null ? ["Distance", "Pace"] : []), "Avg HR", "Load"].map((h) => (
                    <th key={h} className="border-b px-2 py-2 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {recent.map((x) => {
                    const l = trainingLoad(x, max.value, restHr);
                    const current = x.uid === w.uid;
                    return (
                      <tr key={x.uid} className={cn("transition-colors hover:bg-muted/50", current && "bg-exercise/8 font-semibold")}>
                        <td className="px-2 py-1.5">
                          {current ? <span className="inline-flex items-center gap-1.5"><Dumbbell className="size-3.5 text-exercise" />{fmtDay(localDay(x.start_ms))}</span>
                            : <Link href={`/workouts/${encodeURIComponent(x.uid)}`} className="hover:underline">{fmtDay(localDay(x.start_ms))}</Link>}
                        </td>
                        <td className="px-2 py-1.5">{fmtMinutes((x.end_ms - x.start_ms) / 60000)}</td>
                        {typical.km != null && <>
                          <td className="px-2 py-1.5">{x.distance_m ? `${(x.distance_m / 1000).toFixed(2)} km` : "-"}</td>
                          <td className="px-2 py-1.5">{x.distance_m && x.distance_m > 500 ? fmtPace(x.end_ms - x.start_ms, x.distance_m) : "-"}</td>
                        </>}
                        <td className="px-2 py-1.5">{x.avg_hr ? Math.round(x.avg_hr) : "-"}</td>
                        <td className="px-2 py-1.5">{l != null ? Math.round(l) : "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
