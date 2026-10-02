import { CalendarCheck, CalendarDays, Flame, Footprints, Route, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarHeatmap, DailyColumns, TrendChart } from "@/components/dash/charts";
import { Delta, EmptyHint, Panel, SegmentedLinks, StatTile } from "@/components/dash/primitives";
import { PageBody, PageHeader } from "@/components/page-header";
import { GOALS, bucketAvg, dataExtent, fillDays, shiftDay, todayLocal, withRollingAvg } from "@/lib/analytics";
import { fmtDay, fmtNum, fmtPeriod } from "@/lib/format";
import { dailyMetric } from "@/lib/queries";

export const metadata: Metadata = { title: "Activity" };

const RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "3 months" },
  { value: "182", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "all", label: "All" },
];
const BY = [
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  await connection();
  const sp = await searchParams;
  const rangeKey = RANGES.find((r) => r.value === sp.range)?.value ?? "90";
  const by = (BY.find((b) => b.value === sp.by)?.value ?? "week") as "week" | "month";
  const href = (o: { range?: string; by?: string }) => `/activity?range=${o.range ?? rangeKey}&by=${o.by ?? by}`;

  const today = todayLocal();
  const extent = dataExtent();
  const days = rangeKey === "all" && extent ? Math.max(1, Math.round((Date.parse(today) - Date.parse(extent.first)) / 86400000) + 1) : Number(rangeKey === "all" ? 365 : rangeKey);
  const range = { from: shiftDay(today, -(days - 1)), to: today };
  const prev = { from: shiftDay(range.from, -days), to: shiftDay(range.from, -1) };

  const steps = fillDays(range, dailyMetric("steps", range), (r) => r.value);
  const distance = fillDays(range, dailyMetric("distance_m", range), (r) => r.value);
  const active = fillDays(range, dailyMetric("active_kcal", range), (r) => r.value);
  const prevSteps = dailyMetric("steps", prev).map((r) => r.value);
  const prevDist = dailyMetric("distance_m", prev).map((r) => r.value);
  const prevActive = dailyMetric("active_kcal", prev).map((r) => r.value);

  const recorded = steps.filter((s) => s.value != null);
  const goalDays = recorded.filter((s) => s.value! >= GOALS.steps).length;
  const best = [...recorded].sort((a, b) => b.value! - a.value!).slice(0, 5);

  // Average steps by weekday (Monday first)
  const byWeekday = WEEKDAYS.map((label, i) => {
    const vals = recorded.filter((s) => (new Date(`${s.day}T12:00:00`).getDay() + 6) % 7 === i).map((s) => s.value);
    return { label, value: mean(vals) };
  });
  const maxWeekday = Math.max(...byWeekday.map((w) => w.value ?? 0), 1);

  // Longest run of consecutive days meeting the goal, ending at the most recent such streak
  let streak = 0, bestStreak = 0;
  for (const s of steps) {
    streak = s.value != null && s.value >= GOALS.steps ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
  }

  const periodLabel = rangeKey === "all" ? "all time" : RANGES.find((r) => r.value === rangeKey)!.label.toLowerCase();

  return (
    <>
      <PageHeader title="Activity" subtitle={`Steps, distance and calories over ${periodLabel}`}>
        <SegmentedLinks options={RANGES} current={rangeKey} href={(v) => href({ range: v })} />
      </PageHeader>
      <PageBody>
        {recorded.length === 0 ? (
          <EmptyHint icon={Footprints} title="No activity recorded in this period" />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile label="Average steps a day" icon={Footprints} domain="activity" value={fmtNum(mean(steps.map((s) => s.value)) ?? 0)}
                footer={<Delta value={mean(steps.map((s) => s.value))} reference={mean(prevSteps)} upIsGood format={(x) => fmtNum(x)} suffix="vs previous period" />} />
              <StatTile label="Total distance" icon={Route} domain="activity" value={(sum(distance.map((d) => d.value)) / 1000).toFixed(0)} unit="km"
                footer={<Delta value={mean(distance.map((d) => d.value))} reference={mean(prevDist)} upIsGood format={(x) => `${(x / 1000).toFixed(1)} km/day`} suffix="vs previous" />} />
              <StatTile label="Average active calories" icon={Flame} domain="activity"
                value={mean(active.map((a) => a.value)) != null ? fmtNum(mean(active.map((a) => a.value))!) : "-"} unit="kcal"
                footer={<Delta value={mean(active.map((a) => a.value))} reference={mean(prevActive)} upIsGood format={(x) => fmtNum(x)} suffix="vs previous period" />} />
              <StatTile label="Days at step goal" icon={CalendarCheck} domain="activity" value={goalDays} unit={`of ${recorded.length}`}
                footer={<span className="text-xs text-muted-foreground">Longest streak {bestStreak} day{bestStreak === 1 ? "" : "s"}</span>} />
            </div>

            <Panel title="Steps calendar" icon={CalendarDays} domain="activity"
              description={`Darker means more steps. Outlined days met your ${fmtNum(GOALS.steps)} step goal. Click a day to open it.`}>
              <CalendarHeatmap days={steps} label="steps" hrefPrefix="/day/" goal={GOALS.steps} />
            </Panel>

            <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
              <Panel title="Daily steps" icon={Footprints} domain="activity" bodyClassName="flex flex-col [&>div]:flex-1">
                <TrendChart data={withRollingAvg(steps)} label="steps" color="var(--activity)" hrefPrefix="/day/" goal={GOALS.steps} height={420} />
              </Panel>
              <div className="grid gap-4">
                <Panel title="Best days" icon={Trophy} domain="activity">
                  <ol className="-mx-2 space-y-0.5">
                    {best.map((b, i) => (
                      <li key={b.day}>
                        <Link href={`/day/${b.day}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted">
                          <span className="tabular w-4 text-xs text-muted-foreground">{i + 1}</span>
                          <span className="flex-1">{fmtPeriod(b.day, "day")}</span>
                          <span className="tabular font-semibold">{fmtNum(b.value!)}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </Panel>
                <Panel title="By day of the week" description="Average steps">
                  <div className="space-y-1.5">
                    {byWeekday.map((w) => (
                      <div key={w.label} className="grid grid-cols-[2.25rem_1fr_3.5rem] items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{w.label}</span>
                        <div className="h-2.5">
                          <div className="h-2.5 rounded-full bg-activity" style={{ width: `${((w.value ?? 0) / maxWeekday) * 100}%`, opacity: 0.35 + 0.65 * ((w.value ?? 0) / maxWeekday) }} />
                        </div>
                        <span className="tabular text-right font-medium">{w.value != null ? fmtNum(w.value) : "-"}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Distance" icon={Route} domain="activity" description="Kilometres a day">
                <TrendChart data={withRollingAvg(distance.map((d) => ({ day: d.day, value: d.value != null ? d.value / 1000 : null })))}
                  label="km" color="var(--activity)" digits={1} hrefPrefix="/day/" />
              </Panel>
              <Panel title="Active calories" icon={Flame} domain="activity" description="Calories burned through movement">
                {active.some((a) => a.value != null)
                  ? <TrendChart data={withRollingAvg(active)} label="kcal" color="var(--activity)" hrefPrefix="/day/" />
                  : <EmptyHint icon={Flame} title="No active-calorie data in this period" />}
              </Panel>
            </div>

            <Panel title={by === "week" ? "Weekly average" : "Monthly average"} icon={CalendarDays} domain="activity"
              description={`Average steps a day, ${by === "week" ? "each week (Monday to Sunday)" : "each month"}`}
              action={<SegmentedLinks options={BY} current={by} href={(v) => href({ by: v })} />}>
              <DailyColumns data={bucketAvg(steps, by)} label="steps a day" color="var(--activity)" period={by} goal={GOALS.steps} height={220} />
            </Panel>
            <p className="text-center text-xs text-muted-foreground">Data from {fmtDay(recorded[0].day)} to {fmtDay(recorded.at(-1)!.day)}</p>
          </>
        )}
      </PageBody>
    </>
  );
}
