import {
  Activity, AlertTriangle, ArrowRight, BedDouble, Check, Droplets, Dumbbell, Flame, Footprints, HeartPulse,
  Minus, Route, Scale, Sparkles, Waves,
} from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { DailyColumns, Hypnogram, IntradayHr, Sparkline } from "@/components/dash/charts";
import { STAGES } from "@/lib/palette";
import { DateNav } from "@/components/dash/date-nav";
import { Delta, DOMAIN, EmptyHint, IconChip, KV, Panel, PanelLink, StatTile } from "@/components/dash/primitives";
import { ProgressRings, StackedBar } from "@/components/dash/rings";
import {
  GOALS, baselineRestingHr, baselines, dataDays, dayDetail, dayStartMs, latestDataDay, maxHeartRate, recentSeries, shiftDay,
  trainingLoad, workoutsBetween,
} from "@/lib/analytics";
import { fmtClock, fmtLongDay, fmtMinutes, fmtNum, fmtPace, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

type Signal = { name: string; value: string; detail: string; status: "good" | "ok" | "watch"; icon: typeof HeartPulse };

const STATUS = {
  good: { label: "Good", icon: Check, cls: "bg-good/12 text-good" },
  ok: { label: "Normal", icon: Minus, cls: "bg-muted text-muted-foreground" },
  watch: { label: "Watch", icon: AlertTriangle, cls: "bg-warn/12 text-warn" },
} as const;

function greeting(now: Date) {
  const h = now.getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function DayView({ day, today, now }: { day: string; today: string; now: number }) {
  const isToday = day === today;
  const d = dayDetail(day);
  const base = baselines(day);
  const week = recentSeries(day, 7);
  const n = d.night;
  const asleep = n ? n.asleep : null;
  const rhr = d.restingHr.rows[0]?.value ?? null;
  const exerciseMin = d.workouts.reduce((a, w) => a + (w.end_ms - w.start_ms) / 60000, 0);
  const maxHr = maxHeartRate().value;
  const restHr = baselineRestingHr();
  const hasAny = d.steps != null || n != null || d.hr.length > 0 || d.workouts.length > 0;
  const latest = hasAny ? null : latestDataDay();

  // Body check: three transparent signals against your own 30-day usual
  const signals: Signal[] = [];
  if (rhr != null && base.restingHr != null) {
    const diff = rhr - base.restingHr;
    signals.push({
      name: d.restingHr.kind === "resting" ? "Resting heart rate" : "Lowest heart rate", icon: HeartPulse,
      value: `${Math.round(rhr)} bpm`,
      detail: Math.abs(diff) < 1 ? "Same as usual" : `${Math.abs(Math.round(diff))} ${diff > 0 ? "above" : "below"} your usual ${Math.round(base.restingHr)}`,
      status: diff <= -1 ? "good" : diff >= 3 ? "watch" : "ok",
    });
  }
  if (d.hrv && base.hrv != null) {
    const rel = (d.hrv.avg - base.hrv) / base.hrv;
    signals.push({
      name: "Heart rate variability", icon: Waves, value: `${Math.round(d.hrv.avg)} ms`,
      detail: Math.abs(rel) < 0.03 ? "Same as usual" : `${Math.round(Math.abs(rel) * 100)}% ${rel > 0 ? "above" : "below"} your usual ${Math.round(base.hrv)} ms`,
      status: rel >= 0.05 ? "good" : rel <= -0.1 ? "watch" : "ok",
    });
  }
  if (asleep != null) {
    const frac = asleep / GOALS.sleepMin;
    signals.push({
      name: "Sleep", icon: BedDouble, value: fmtMinutes(asleep),
      detail: frac >= 1 ? "Met your sleep goal" : `${fmtMinutes(GOALS.sleepMin - asleep)} short of your ${fmtMinutes(GOALS.sleepMin)} goal`,
      status: frac >= 0.9 ? "good" : frac < 0.75 ? "watch" : "ok",
    });
  }
  const watch = signals.filter((s) => s.status === "watch").length;
  const good = signals.filter((s) => s.status === "good").length;
  const verdict = signals.length === 0 ? null
    : watch >= 2 ? { title: "Take it easy", text: "Several signals are off your usual. A lighter day may help you recover." }
    : watch === 1 ? { title: "Mostly on track", text: "One signal is off your usual. Worth keeping an eye on." }
    : good >= 2 ? { title: "Well recovered", text: "Your body signals look better than usual." }
    : { title: "On track", text: "Your body signals are close to your usual." };

  const rings = [
    { label: "Steps", value: d.steps ?? 0, goal: GOALS.steps, color: "var(--activity)", display: fmtNum(d.steps ?? 0), goalDisplay: fmtNum(GOALS.steps), icon: Footprints, domain: "activity" as const },
    { label: "Sleep", value: asleep ?? 0, goal: GOALS.sleepMin, color: "var(--sleep)", display: asleep != null ? fmtMinutes(asleep) : "-", goalDisplay: fmtMinutes(GOALS.sleepMin), icon: BedDouble, domain: "sleep" as const },
    { label: "Exercise", value: exerciseMin, goal: GOALS.exerciseMin, color: "var(--exercise)", display: `${Math.round(exerciseMin)} min`, goalDisplay: `${GOALS.exerciseMin} min`, icon: Dumbbell, domain: "exercise" as const },
  ];

  const hrTo = isToday ? Math.min(d.end, now) : d.end;
  const hrFrom = n ? Math.min(n.start_ms, d.start) : d.start;
  const askPrompts = isToday
    ? ["How did I sleep last night?", "Am I recovered enough to train hard today?", "How does today compare with my usual?"]
    : [`How did I sleep on the night before ${day}?`, `Was ${day} a typical day for me?`, `What stood out on ${day}?`];

  return (
    <>
      <PageHeader
        title={isToday ? greeting(new Date(now)) : fmtLongDay(day)}
        subtitle={isToday ? fmtLongDay(day) : day === shiftDay(today, -1) ? "Yesterday" : undefined}>
        <DateNav day={day} today={today} dataDays={dataDays()} />
      </PageHeader>
      <PageBody>
        {!hasAny && (
          <EmptyHint icon={Activity} title={isToday ? "Nothing synced for today yet" : "No data for this day"}>
            {isToday ? "Open Watch Sync on your phone and tap Sync now, or wait for the hourly sync." : "Your watch didn't record anything this day."}
            {latest && latest !== day && (
              <Link href={latest === today ? "/" : `/day/${latest}`} className="mt-2 inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-4">
                Go to the latest day with data <ArrowRight className="size-3" />
              </Link>
            )}
          </EmptyHint>
        )}

        {/* Goals and body check */}
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <Panel bodyClassName="flex items-center">
            <div className="flex w-full flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-10">
              <ProgressRings size={196} rings={rings.map((r) => ({ label: r.label, value: r.value, goal: r.goal, color: r.color, display: r.display, goalDisplay: r.goalDisplay }))} />
              <div className="grid w-full gap-4">
                {rings.map((r) => (
                  <div key={r.label} className="flex items-center gap-3">
                    <IconChip icon={r.icon} domain={r.domain} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">{r.label}</div>
                      <div className="tabular text-lg font-semibold leading-tight">
                        {r.display}
                        <span className="ml-1 text-sm font-normal text-muted-foreground">/ {r.goalDisplay}</span>
                      </div>
                    </div>
                    <span className={cn("tabular text-sm font-semibold", DOMAIN[r.domain].text)}>
                      {r.goal ? Math.round((r.value / r.goal) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Body check" description="Today against your own 30-day usual">
            {verdict ? (
              <div className="space-y-4">
                <div>
                  <p className="text-xl font-semibold tracking-tight">{verdict.title}</p>
                  <p className="text-sm text-muted-foreground">{verdict.text}</p>
                </div>
                <ul className="space-y-3">
                  {signals.map((s) => {
                    const st = STATUS[s.status];
                    return (
                      <li key={s.name} className="flex items-center gap-3">
                        <s.icon className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm"><span className="font-medium">{s.name}</span> <span className="tabular text-muted-foreground">{s.value}</span></div>
                          <div className="text-xs text-muted-foreground">{s.detail}</div>
                        </div>
                        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>
                          <st.icon className="size-3" />{st.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : <p className="text-sm text-muted-foreground">Not enough data yet to compare with your usual.</p>}
          </Panel>
        </div>

        {/* Key numbers */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Steps" icon={Footprints} domain="activity" value={d.steps != null ? fmtNum(d.steps) : "-"} href="/activity"
            footer={<Delta value={d.steps} reference={base.steps} upIsGood format={(x) => fmtNum(x)} />}>
            <Sparkline values={week.steps.map((x) => x.value)} color="var(--activity)" />
          </StatTile>
          <StatTile label="Distance" icon={Route} domain="activity" value={d.distance_m != null ? (d.distance_m / 1000).toFixed(1) : "-"} unit="km" href="/activity"
            footer={<Delta value={d.distance_m} reference={base.distance_m} upIsGood format={(x) => `${(x / 1000).toFixed(1)} km`} />}>
            <Sparkline values={week.distance.map((x) => x.value)} color="var(--activity)" />
          </StatTile>
          <StatTile label="Active calories" icon={Flame} domain="activity" value={d.active_kcal != null ? fmtNum(d.active_kcal) : "-"} unit="kcal" href="/activity"
            footer={d.active_kcal != null ? <Delta value={d.active_kcal} reference={base.active_kcal} upIsGood format={(x) => fmtNum(x)} />
              : d.total_kcal != null ? <span className="text-xs text-muted-foreground">{fmtNum(d.total_kcal)} kcal total</span> : null}>
            <Sparkline values={week.activeKcal.map((x) => x.value)} color="var(--activity)" />
          </StatTile>
          <StatTile label="Exercise" icon={Dumbbell} domain="exercise" value={Math.round(exerciseMin)} unit="min" href="/workouts"
            footer={<span className="text-xs text-muted-foreground">{d.workouts.length ? `${d.workouts.length} workout${d.workouts.length > 1 ? "s" : ""}` : "No workouts"}</span>}>
            <Sparkline values={week.exerciseMin.map((x) => x.value)} color="var(--exercise)" />
          </StatTile>
          <StatTile label={d.restingHr.kind === "resting" ? "Resting heart rate" : "Lowest heart rate"} icon={HeartPulse} domain="heart"
            value={rhr != null ? Math.round(rhr) : "-"} unit="bpm" href="/heart"
            footer={<Delta value={rhr} reference={base.restingHr} upIsGood={false} format={(x) => `${Math.round(x)}`} threshold={0.015} />}>
            <Sparkline values={week.restingHr.map((x) => x.value)} color="var(--heart)" />
          </StatTile>
          <StatTile label="HRV" icon={Waves} domain="heart" value={d.hrv ? Math.round(d.hrv.avg) : "-"} unit="ms" href="/heart"
            footer={<Delta value={d.hrv?.avg} reference={base.hrv} upIsGood format={(x) => `${Math.round(x)} ms`} threshold={0.03} />}>
            <Sparkline values={week.hrv.map((x) => x.value)} color="var(--heart)" />
          </StatTile>
          <StatTile label="Blood oxygen" icon={Droplets} domain="body" value={d.spo2 ? d.spo2.avg.toFixed(1) : "-"} unit="%" href="/heart"
            footer={d.spo2 ? <span className="text-xs text-muted-foreground">usual {base.spo2 != null ? `${base.spo2.toFixed(1)}%` : "-"}</span> : <span className="text-xs text-muted-foreground">No reading</span>}>
            <Sparkline values={week.spo2.map((x) => x.value)} color="var(--body)" />
          </StatTile>
          <StatTile label="Weight" icon={Scale} domain="body" value={d.weight ? d.weight.avg.toFixed(1) : base.weight != null ? base.weight.toFixed(1) : "-"} unit="kg" href="/heart"
            footer={<span className="text-xs text-muted-foreground">{d.weight ? "Measured this day" : base.weight != null ? "Last measurement" : "No measurements"}</span>}>
            <Sparkline values={week.weight.map((x) => x.value)} color="var(--body)" />
          </StatTile>
        </div>

        {/* Heart rate and last night */}
        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Panel title="Heart rate" icon={HeartPulse} domain="heart"
            description={d.hrStats ? `${Math.round(d.hrStats.min)} to ${Math.round(d.hrStats.max)} bpm, average ${Math.round(d.hrStats.avg)}` : "No readings"}
            action={<PanelLink href="/heart">Trends</PanelLink>}>
            {d.hr.length > 1 ? (
              <IntradayHr points={d.hr.filter((p) => p.t >= hrFrom && p.t <= hrTo)} from={hrFrom} to={hrTo} height={250} bands={[
                ...(n ? [{ from: n.start_ms, to: n.end_ms, label: "Sleep", color: "var(--sleep)" }] : []),
                ...d.workouts.map((w) => ({ from: w.start_ms, to: w.end_ms, label: titleCase(w.type), color: "var(--exercise)" })),
              ]} />
            ) : <EmptyHint icon={HeartPulse} title="No heart-rate readings" />}
          </Panel>

          <Panel title="Last night" icon={BedDouble} domain="sleep"
            description={n ? `${fmtClock(n.start_ms)} to ${fmtClock(n.end_ms)}` : "No sleep recorded"}
            action={<PanelLink href="/sleep">Sleep</PanelLink>}>
            {n ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <KV label="Asleep" value={fmtMinutes(asleep!)} sub={base.asleep != null ? `usual ${fmtMinutes(base.asleep)}` : undefined} />
                  <KV label="Efficiency" value={`${Math.round((asleep! / n.total_min) * 100)}%`} sub={`${fmtMinutes(n.total_min)} in bed`} />
                  <KV label="Score" value={n.score ?? "-"} />
                </div>
                {d.stages.length > 0 && (
                  <>
                    <div className="space-y-2">
                      <StackedBar parts={STAGES.map((s) => ({ label: s.label, value: n[s.key], color: s.color }))} />
                      <div className="grid grid-cols-4 gap-2 text-xs">
                        {STAGES.map((s) => (
                          <div key={s.key}>
                            <div className="flex items-center gap-1 text-muted-foreground"><span className="size-2 rounded-[2px]" style={{ background: s.color }} />{s.label}</div>
                            <div className="tabular font-semibold">{fmtMinutes(n[s.key])}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Hypnogram stages={d.stages} from={n.start_ms} to={n.end_ms} compact />
                  </>
                )}
              </div>
            ) : <EmptyHint icon={BedDouble} title="No sleep recorded">Wear your watch to bed to track sleep.</EmptyHint>}
          </Panel>
        </div>

        {/* Week context, workouts, ask */}
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Panel title="Steps this week" icon={Footprints} domain="activity" description={`Average ${fmtNum(base.steps ?? 0)} a day over the last 30 days`}>
            <DailyColumns data={week.steps} label="steps" color="var(--activity)" goal={GOALS.steps} hrefPrefix="/day/" height={170} highlight={day} />
          </Panel>

          <Panel title={d.workouts.length ? "Workouts" : "Recent workouts"} icon={Dumbbell} domain="exercise"
            action={<PanelLink href="/workouts">All</PanelLink>}>
            {(() => {
              const list = d.workouts.length ? d.workouts : recentWorkouts(week.days);
              if (!list.length) return <EmptyHint icon={Dumbbell} title="No workouts this week" />;
              return (
                <ul className="-mx-2 space-y-1">
                  {list.slice(0, 4).map((w) => {
                    const load = trainingLoad(w, maxHr, restHr);
                    return (
                      <li key={w.uid}>
                        <Link href={`/workouts/${encodeURIComponent(w.uid)}`} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted">
                          <IconChip icon={Dumbbell} domain="exercise" size="sm" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{w.title ?? titleCase(w.type)}</div>
                            <div className="tabular text-xs text-muted-foreground">
                              {new Date(w.start_ms).toLocaleDateString(undefined, { weekday: "short" })} {fmtClock(w.start_ms)}
                              {" · "}{fmtMinutes((w.end_ms - w.start_ms) / 60000)}
                              {w.distance_m ? ` · ${(w.distance_m / 1000).toFixed(1)} km` : ""}
                              {w.distance_m && w.type === "running" ? ` · ${fmtPace(w.end_ms - w.start_ms, w.distance_m)}` : ""}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="tabular text-sm font-semibold">{w.avg_hr ? Math.round(w.avg_hr) : "-"}</div>
                            <div className="text-[11px] text-muted-foreground">{load ? `load ${Math.round(load)}` : "avg bpm"}</div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </Panel>

          <Panel title="Ask about your data" icon={Sparkles} className="lg:col-span-2 xl:col-span-1">
            <div className="space-y-2">
              {askPrompts.map((q) => (
                <Link key={q} href={`/chat?q=${encodeURIComponent(q)}`}
                  className="group flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-ring/60 hover:bg-muted/50">
                  {q}
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </PageBody>
    </>
  );
}

function recentWorkouts(days: string[]) {
  return workoutsBetween(dayStartMs(days[0]), dayStartMs(shiftDay(days.at(-1)!, 1)));
}
