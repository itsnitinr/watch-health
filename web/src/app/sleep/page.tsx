import { AlarmClock, BedDouble, CalendarRange, Gauge, Hourglass, Layers, ListOrdered, Moon, Star } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BedWakeChart, SleepStages, TrendChart } from "@/components/dash/charts";
import { STAGES } from "@/lib/palette";
import { EmptyHint, KV, Panel, SegmentedLinks, StatTile } from "@/components/dash/primitives";
import { StackedBar } from "@/components/dash/rings";
import { PageBody, PageHeader } from "@/components/page-header";
import { SLEEP_GOAL_MIN, fillDays, nights, shiftDay, sleepSummary, todayLocal, withRollingAvg } from "@/lib/analytics";
import { fmtDay, fmtMinutes, fmtTimeOfNight } from "@/lib/format";
import { listDays } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Sleep" };

const RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "3 months" },
  { value: "182", label: "6 months" },
  { value: "365", label: "1 year" },
];

// General adult reference ranges, as a share of time asleep.
const TYPICAL = { deep: [0.13, 0.23], rem: [0.2, 0.25], light: [0.5, 0.6] } as const;

export default async function SleepPage({ searchParams }: PageProps<"/sleep">) {
  await connection();
  const sp = await searchParams;
  const rangeKey = RANGES.find((r) => r.value === sp.range)?.value ?? "30";
  const today = todayLocal();
  const range = { from: shiftDay(today, -(Number(rangeKey) - 1)), to: today };
  const ns = nights(range);

  const header = (
    <PageHeader title="Sleep" subtitle="Duration, timing, consistency and sleep stages">
      <SegmentedLinks options={RANGES} current={rangeKey} href={(v) => `/sleep?range=${v}`} />
    </PageHeader>
  );
  if (ns.length === 0) {
    return <>{header}<PageBody><EmptyHint icon={BedDouble} title="No sleep recorded in this period">Wear your watch to bed to track sleep.</EmptyHint></PageBody></>;
  }

  const s = sleepSummary(ns);
  const byDay = new Map(ns.map((n) => [n.day, n]));
  const days = listDays(range);
  const midpoint = (g: { bedMin: number | null; wakeMin: number | null }) =>
    g.bedMin != null && g.wakeMin != null ? (g.bedMin + g.wakeMin) / 2 : null;
  const jetlag = midpoint(s.weekday) != null && midpoint(s.weekend) != null ? Math.abs(midpoint(s.weekend)! - midpoint(s.weekday)!) : null;
  const goalNights = ns.filter((n) => n.asleep >= SLEEP_GOAL_MIN).length;
  const consistency = s.bedStdev == null ? null : s.bedStdev <= 30 ? "Very consistent" : s.bedStdev <= 60 ? "Fairly consistent" : "Irregular";

  return (
    <>
      {header}
      <PageBody>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Average time asleep" icon={Moon} domain="sleep" value={s.asleep != null ? fmtMinutes(s.asleep) : "-"}
            footer={<span className="text-xs text-muted-foreground">{goalNights} of {ns.length} nights met your {fmtMinutes(SLEEP_GOAL_MIN)} goal</span>} />
          <StatTile label="Sleep debt" icon={Hourglass} domain="sleep" value={fmtMinutes(s.debtMin)}
            footer={<span className="text-xs text-muted-foreground">Net shortfall over the last {s.debtNights} nights</span>} />
          <StatTile label="Usual bedtime" icon={BedDouble} domain="sleep" value={s.bedMin != null ? fmtTimeOfNight(s.bedMin) : "-"}
            footer={<span className="text-xs text-muted-foreground">{consistency ? `${consistency}, ±${Math.round(s.bedStdev!)} min` : ""}</span>} />
          <StatTile label="Usual wake time" icon={AlarmClock} domain="sleep" value={s.wakeMin != null ? fmtTimeOfNight(s.wakeMin) : "-"}
            footer={<span className="text-xs text-muted-foreground">{s.wakeStdev != null ? `Varies ±${Math.round(s.wakeStdev)} min` : ""}</span>} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Time asleep" icon={Moon} domain="sleep" description={`Each night, with the 7-day average. Goal ${fmtMinutes(SLEEP_GOAL_MIN)} (change with SLEEP_GOAL_HOURS).`}>
            <TrendChart data={withRollingAvg(fillDays(range, ns, (n) => n.asleep))} label="asleep" color="var(--sleep)" format="minutes"
              hrefPrefix="/day/" goal={SLEEP_GOAL_MIN} height={240} />
          </Panel>
          <Panel title="Bedtime and wake time" icon={CalendarRange} domain="sleep" description="Each bar runs from falling asleep to waking up">
            <BedWakeChart hrefPrefix="/day/" height={268} data={days.map((day) => {
              const n = byDay.get(day);
              return { day, range: n ? [n.bedMin, n.wakeMin] as [number, number] : null, asleep: n?.asleep ?? null };
            })} />
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Panel title="Sleep stages by night" icon={Layers} domain="sleep">
            <SleepStages hrefPrefix="/day/" height={240} data={days.map((day) => {
              const n = byDay.get(day);
              return { day, deep: n?.deep ?? 0, rem: n?.rem ?? 0, light: n?.light ?? 0, awake: n?.awake ?? 0, total_min: n?.total_min ?? 0 };
            })} />
          </Panel>
          <Panel title="Stage balance" icon={Gauge} domain="sleep" description="Your average share of sleep in each stage, with typical adult ranges">
            {s.stagePct ? (
              <div className="space-y-5">
                <StackedBar height={14} parts={[
                  { label: "Deep", value: s.stagePct.deep, color: "var(--stage-deep)" },
                  { label: "REM", value: s.stagePct.rem, color: "var(--stage-rem)" },
                  { label: "Light", value: s.stagePct.light, color: "var(--stage-light)" },
                ]} />
                <div className="space-y-3">
                  {(["deep", "rem", "light"] as const).map((k) => {
                    const v = s.stagePct![k];
                    const [lo, hi] = TYPICAL[k];
                    const within = v >= lo && v <= hi;
                    const stage = STAGES.find((x) => x.key === k)!;
                    return (
                      <div key={k} className="flex items-center gap-3">
                        <span className="size-2.5 rounded-[3px]" style={{ background: stage.color }} />
                        <span className="flex-1 text-sm">{stage.label}</span>
                        <span className="tabular text-sm font-semibold">{Math.round(v * 100)}%</span>
                        <span className={cn("w-36 rounded-full px-2 py-0.5 text-center text-xs", within ? "bg-good/12 text-good" : "bg-warn/12 text-warn")}>
                          {within ? "Typical" : v < lo ? "Below typical" : "Above typical"} ({Math.round(lo * 100)}-{Math.round(hi * 100)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3 border-t pt-4">
                  <KV label="Efficiency" value={s.efficiency != null ? `${Math.round(s.efficiency * 100)}%` : "-"} sub="time asleep while in bed" />
                  <KV label="Sleep score" value={s.score != null ? Math.round(s.score) : "-"} sub="Samsung Health, average" />
                </div>
                <p className="text-xs text-muted-foreground">Stage estimates from a wrist sensor are approximate. Trends matter more than single nights.</p>
              </div>
            ) : <EmptyHint icon={Layers} title="No stage detail in this period" />}
          </Panel>
        </div>

        <Panel title="Weeknights vs weekends" icon={Star} domain="sleep"
          description={jetlag != null ? `Your sleep midpoint shifts by ${fmtMinutes(jetlag)} at weekends. Under an hour is easier on your body clock.` : "Sunday to Thursday nights compared with Friday and Saturday nights"}>
          <div className="grid gap-4 sm:grid-cols-2">
            {([["Sun to Thu nights", s.weekday], ["Fri and Sat nights", s.weekend]] as const).map(([label, g]) => (
              <div key={label} className="rounded-xl bg-muted/60 p-4">
                <div className="mb-3 text-sm font-medium">{label} <span className="font-normal text-muted-foreground">· {g.nights} nights</span></div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <KV label="Asleep" value={g.asleep != null ? fmtMinutes(g.asleep) : "-"} />
                  <KV label="Bedtime" value={g.bedMin != null ? fmtTimeOfNight(g.bedMin) : "-"} />
                  <KV label="Wake" value={g.wakeMin != null ? fmtTimeOfNight(g.wakeMin) : "-"} />
                  <KV label="Score" value={g.score != null ? Math.round(g.score) : "-"} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Every night" icon={ListOrdered} domain="sleep" description="Most recent first. Click a night to see its timeline and heart rate.">
          <div className="max-h-[30rem] overflow-auto">
            <table className="tabular w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                <tr>{["Night ending", "Asleep", "Bedtime", "Wake", "Efficiency", "Stages", "Score"].map((h) => (
                  <th key={h} className="border-b px-2 py-2 font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {[...ns].reverse().map((n) => (
                  <tr key={n.uid} className="transition-colors hover:bg-muted/50">
                    <td className="px-2 py-1.5"><Link href={`/day/${n.day}`} className="font-medium hover:underline">{fmtDay(n.day)}</Link></td>
                    <td className={cn("px-2 py-1.5 font-semibold", n.asleep >= SLEEP_GOAL_MIN && "text-sleep")}>{fmtMinutes(n.asleep)}</td>
                    <td className="px-2 py-1.5">{fmtTimeOfNight(n.bedMin)}</td>
                    <td className="px-2 py-1.5">{fmtTimeOfNight(n.wakeMin)}</td>
                    <td className="px-2 py-1.5">{Math.round(n.efficiency * 100)}%</td>
                    <td className="w-40 px-2 py-1.5">
                      <StackedBar height={8} parts={STAGES.map((st) => ({ label: st.label, value: n[st.key], color: st.color }))} />
                    </td>
                    <td className="px-2 py-1.5">{n.score ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </PageBody>
    </>
  );
}
