import { BedDouble, Dumbbell, HeartPulse, Microscope } from "lucide-react";
import Link from "next/link";
import { Hypnogram, IntradayHr, Legend, StrainBuild, ZoneBars } from "@/components/dash/charts";
import { DetailTabs } from "@/components/dash/detail-tabs";
import { Delta, EmptyHint, KV, Panel } from "@/components/dash/primitives";
import { StackedBar } from "@/components/dash/rings";
import { ZONES, zoneLabels, type dayDetail } from "@/lib/analytics";
import { dayDrilldown } from "@/lib/drilldown";
import { fmtClock, fmtMinutes, fmtNum, fmtPace, fmtTimeOfNight, titleCase } from "@/lib/format";
import { STAGES, ZONE_COLORS } from "@/lib/palette";

type Drill = ReturnType<typeof dayDrilldown>;
type Detail = ReturnType<typeof dayDetail>;

/** The section heading inside a tab. */
function Sub({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const usualSub = (v: string | null) => (v ? `usual ${v}` : undefined);

export function DayDetail({ day, d, now, strainTarget }: { day: string; d: Detail; now: number; strainTarget: [number, number] | null }) {
  const x = dayDrilldown(day, d, now);
  return (
    <Panel title="Day in detail" icon={Microscope} description="Heart rate, last night and the shape of the day, minute by minute">
      <DetailTabs tabs={[
        { value: "heart", label: "Heart", content: <HeartTab x={x} d={d} strainTarget={strainTarget} /> },
        { value: "sleep", label: "Sleep", content: <SleepTab x={x} d={d} /> },
        { value: "activity", label: "Activity", content: <ActivityTab x={x} d={d} now={now} /> },
      ]} />
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

function HeartTab({ x, d, strainTarget }: { x: Drill; d: Detail; strainTarget: [number, number] | null }) {
  const h = x.heart;
  if (h.readings < 2) return <EmptyHint icon={HeartPulse} title="No heart-rate readings this day" />;
  const awakeHr = d.hr.filter((p) => p.t >= h.awakeFrom && p.t < x.end);
  const workoutBands = d.workouts.map((w) => ({ from: w.start_ms, to: w.end_ms, label: w.title ?? w.type }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KV label="Lowest while awake" value={h.lowest != null ? `${Math.round(h.lowest)} bpm` : "-"} />
        <KV label="Average while awake" value={h.average != null ? `${Math.round(h.average)} bpm` : "-"} sub="time-weighted" />
        <KV label="Highest" value={h.highest != null ? `${Math.round(h.highest)} bpm` : "-"} />
        <KV label="Hardest 10 minutes" value={h.peak10 ? `${Math.round(h.peak10.bpm)} bpm` : "-"}
          sub={h.peak10 ? `from ${fmtClock(h.peak10.at)}` : undefined} />
        <KV label="Raised heart rate" value={fmtMinutes(h.raisedMin)} sub={`at ${h.raisedFloor}+ bpm`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Sub title="Heart rate while awake" aside={`from ${fmtClock(h.awakeFrom)}`}>
          {awakeHr.length > 1 ? (
            <IntradayHr points={awakeHr} from={h.awakeFrom} to={x.end} height={230}
              zoneBands={ZONES.map((z, i) => ({
                lo: Math.round(z.lo * x.maxHr), hi: z.hi === Infinity ? 250 : Math.round(z.hi * x.maxHr), color: ZONE_COLORS[i],
              }))}
              bands={d.workouts.map((w) => ({ from: w.start_ms, to: w.end_ms, label: "", color: "var(--exercise)" }))} />
          ) : <EmptyHint icon={HeartPulse} title="No readings since waking" />}
        </Sub>
        <Sub title="How strain built up" aside={`ended at ${Math.round(h.strainSeries.at(-1)?.strain ?? 0)}`}>
          <StrainBuild points={h.strainSeries} from={d.start} to={x.end} bands={workoutBands} target={strainTarget} height={230} />
          <Legend items={[
            { label: "Strain so far", color: "var(--strain)", shape: "line" },
            { label: "Workouts", color: "color-mix(in oklab, var(--exercise) 35%, transparent)" },
            ...(strainTarget ? [{ label: `Target ${strainTarget[0]}-${strainTarget[1]}`, color: "color-mix(in oklab, var(--strain) 25%, transparent)" }] : []),
          ]} />
        </Sub>
      </div>

      <Sub title="Time in heart-rate zones while awake"
        aside={`${fmtMinutes(h.zones.reduce((a, b) => a + b, 0) / 60)} covered by readings; gaps over 5 min aren't counted`}>
        <ZoneBars seconds={h.zones} zones={zoneLabels(x.maxHr)} />
      </Sub>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function SleepTab({ x, d }: { x: Drill; d: Detail }) {
  const n = d.night;
  const s = x.sleep;
  if (!n || !s) return <EmptyHint icon={BedDouble} title="No sleep recorded the night before">Wear your watch to bed to track sleep.</EmptyHint>;
  const u = s.usual;
  const stageRows = STAGES.map((st) => ({ ...st, min: n[st.key], usual: u[st.key] }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KV label="Went to bed" value={fmtClock(n.start_ms)} sub={usualSub(u.bedMin != null ? fmtTimeOfNight(u.bedMin) : null)} />
        <KV label="Woke up" value={fmtClock(n.end_ms)} sub={usualSub(u.wakeMin != null ? fmtTimeOfNight(u.wakeMin) : null)} />
        <KV label="Asleep" value={fmtMinutes(n.asleep)} sub={usualSub(u.asleep != null ? fmtMinutes(u.asleep) : null)} />
        <KV label="Efficiency" value={`${Math.round(n.efficiency * 100)}%`} sub={usualSub(u.efficiency != null ? `${Math.round(u.efficiency * 100)}%` : null)} />
        <KV label="In bed" value={fmtMinutes(n.total_min)} sub={s.sessions > 1 ? `${s.sessions} sessions joined` : undefined} />
        <KV label="Awakenings" value={s.awakenings} sub="awake 2+ min" />
        <KV label="Longest unbroken sleep" value={fmtMinutes(s.longestMin)} />
        <KV label="Lowest heart rate" value={s.lowestHr != null ? `${Math.round(s.lowestHr)} bpm` : "-"} />
        <KV label="Average heart rate" value={s.averageHr != null ? `${Math.round(s.averageHr)} bpm` : "-"} />
        <KV label="Blood oxygen" value={s.spo2 ? `${s.spo2.avg.toFixed(1)}%` : "-"}
          sub={s.spo2 ? `lowest ${s.spo2.min.toFixed(0)}%, ${s.spo2.n} reading${s.spo2.n > 1 ? "s" : ""}` : "No readings"} />
      </div>

      {s.stages.length > 0 && (
        <Sub title="Sleep stages" aside={`${fmtClock(n.start_ms)} to ${fmtClock(n.end_ms)}`}>
          <Hypnogram stages={s.stages} from={n.start_ms} to={n.end_ms} />
        </Sub>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Sub title="Heart rate overnight">
          {s.hr.length > 1 ? <IntradayHr points={s.hr} from={n.start_ms} to={n.end_ms} height={200} color="var(--sleep)" />
            : <EmptyHint icon={HeartPulse} title="No overnight readings" />}
        </Sub>
        <Sub title="Time in each stage">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="pb-2 text-left font-normal">Stage</th><th className="pb-2 text-right font-normal">Time</th>
                <th className="pb-2 text-right font-normal">Share</th><th className="pb-2 text-right font-normal">Usual</th></tr>
            </thead>
            <tbody className="tabular">
              {stageRows.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="py-2"><span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-[3px]" style={{ background: r.color }} />{r.label}</span></td>
                  <td className="py-2 text-right font-semibold">{fmtMinutes(r.min)}</td>
                  <td className="py-2 text-right">{n.total_min ? Math.round((r.min / n.total_min) * 100) : 0}%</td>
                  <td className="py-2 text-right text-muted-foreground">{r.usual != null ? fmtMinutes(r.usual) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sub>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function ActivityTab({ x, d, now }: { x: Drill; d: Detail; now: number }) {
  const t = x.activity.totals;
  const ws = x.activity.workouts;
  return (
    <div className="space-y-6">
      <Sub title="Timeline">
        <DayTimeline from={d.start} to={d.end} now={now < d.end ? now : null} lanes={[
          { label: "Sleep", color: "var(--sleep)", segments: x.activity.timeline.sleep.map((s) => ({ ...s, label: "Asleep" })) },
          { label: "Workouts", color: "var(--exercise)", segments: x.activity.timeline.workouts.map((s) => ({ ...s, label: titleCase(s.label) })) },
          { label: "Raised HR", color: "var(--strain)", segments: x.activity.timeline.raised.map((s) => ({ ...s, label: "Raised heart rate" })) },
        ]} />
      </Sub>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KV label="Steps" value={t.steps.value != null ? fmtNum(t.steps.value) : "-"}
          sub={<Delta value={t.steps.value} reference={t.steps.usual} upIsGood format={(v) => fmtNum(v)} />} />
        <KV label={t.distance_m.estimated ? "Distance (from steps)" : "Distance"} value={t.distance_m.value != null ? `${(t.distance_m.value / 1000).toFixed(1)} km` : "-"}
          sub={<Delta value={t.distance_m.value} reference={t.distance_m.usual} upIsGood format={(v) => `${(v / 1000).toFixed(1)} km`} />} />
        <KV label="Active calories" value={t.active_kcal.value != null ? `${fmtNum(t.active_kcal.value)} kcal` : "-"}
          sub={<Delta value={t.active_kcal.value} reference={t.active_kcal.usual} upIsGood format={(v) => fmtNum(v)} />} />
        <KV label="Resting calories" value={t.basal_kcal.value != null ? `${fmtNum(t.basal_kcal.value)} kcal` : "-"} sub="burned at rest" />
        <KV label="Total calories" value={t.total_kcal.value != null ? `${fmtNum(t.total_kcal.value)} kcal` : "-"}
          sub={t.total_kcal.usual != null ? `usual ${fmtNum(t.total_kcal.usual)}` : undefined} />
      </div>

      <Sub title="Workouts" aside={ws.length ? `${ws.length} including auto-detected` : undefined}>
        {ws.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>{["Time", "Activity", "Duration", "Distance", "Avg / max HR", "Load", "Zones"].map((c, i) => (
                  <th key={c} className={`px-2 pb-2 font-normal ${i < 2 || i === 6 ? "text-left" : "text-right"}`}>{c}</th>
                ))}</tr>
              </thead>
              <tbody className="tabular">
                {ws.map((w) => {
                  const zoneTotal = w.zones.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={w.uid} className="border-t">
                      <td className="px-2 py-2 text-muted-foreground">{fmtClock(w.start_ms)}</td>
                      <td className="px-2 py-2">
                        <Link href={`/workouts/${encodeURIComponent(w.uid)}`} className="font-medium underline-offset-4 hover:underline">{w.title ?? titleCase(w.type)}</Link>
                        {!!w.auto && <span className="ml-1.5 text-xs text-muted-foreground">auto</span>}
                      </td>
                      <td className="px-2 py-2 text-right">{fmtMinutes((w.end_ms - w.start_ms) / 60000)}</td>
                      <td className="px-2 py-2 text-right">
                        {w.distance_m ? `${(w.distance_m / 1000).toFixed(1)} km` : "-"}
                        {w.distance_m && w.type === "running" ? <div className="text-xs text-muted-foreground">{fmtPace(w.end_ms - w.start_ms, w.distance_m)}</div> : null}
                      </td>
                      <td className="px-2 py-2 text-right">{w.avg_hr ? Math.round(w.avg_hr) : "-"} / {w.max_hr ? Math.round(w.max_hr) : "-"}</td>
                      <td className="px-2 py-2 text-right font-semibold">{w.load ? Math.round(w.load) : "-"}</td>
                      <td className="w-32 px-2 py-2">
                        {zoneTotal ? <StackedBar height={8} parts={w.zones.map((s, i) => ({ label: `Zone ${i + 1}`, value: s, color: ZONE_COLORS[i] }))} />
                          : <span className="text-xs text-muted-foreground">No readings</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyHint icon={Dumbbell} title="No workouts this day" />}
      </Sub>
    </div>
  );
}

/** The 24 hours as lanes of shaded spans, with a "now" line on today. */
function DayTimeline({ from, to, now, lanes }: {
  from: number; to: number; now: number | null;
  lanes: { label: string; color: string; segments: { from: number; to: number; label: string }[] }[];
}) {
  const pct = (t: number) => ((Math.min(to, Math.max(from, t)) - from) / (to - from)) * 100;
  const ticks = Array.from({ length: 9 }, (_, i) => from + i * 3 * 3600000).filter((t) => t <= to);
  return (
    <div className="flex gap-3 text-xs">
      <div className="flex w-16 shrink-0 flex-col gap-1.5 text-muted-foreground">
        {lanes.map((l) => <span key={l.label} className="h-5 leading-5">{l.label}</span>)}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-col gap-1.5">
          {lanes.map((l) => (
            <div key={l.label} className="relative h-5 rounded bg-muted/60">
              {l.segments.map((s) => (
                <div key={s.from} title={`${s.label}: ${fmtClock(s.from)} to ${fmtClock(s.to)} (${fmtMinutes((s.to - s.from) / 60000)})`}
                  className="absolute inset-y-0 rounded" style={{
                    left: `${pct(s.from)}%`, width: `max(2px, ${pct(s.to) - pct(s.from)}%)`, background: l.color,
                  }} />
              ))}
            </div>
          ))}
        </div>
        {now && <div className="absolute -top-1 bottom-4 w-px bg-foreground/60" style={{ left: `${pct(now)}%` }} title={`Now, ${fmtClock(now)}`} />}
        <div className="relative mt-1 h-4 text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={t} className={`tabular absolute ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
              style={{ left: `${pct(t)}%` }}>{fmtClock(t)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
