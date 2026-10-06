import { Activity, ListOrdered, Percent, Ruler, Scale, TrendingDown, TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DailyLine, TrendChart } from "@/components/dash/charts";
import { EmptyHint, Panel, SegmentedLinks, StatTile } from "@/components/dash/primitives";
import { PageBody, PageHeader } from "@/components/page-header";
import { BODY_COMPOSITION, dayStartMs, fillDays, heightM, nowMs, shiftDay, todayLocal, weighIns } from "@/lib/analytics";
import { fmtAgo, fmtClock, fmtDay } from "@/lib/format";
import { dailySampleStats } from "@/lib/queries";

export const metadata: Metadata = { title: "Body" };

const RANGES = [
  { value: "90", label: "3 months" },
  { value: "182", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "all", label: "All" },
];

const SOURCES: Record<string, string> = {
  "com.sec.android.app.shealth": "Samsung Health",
  "com.google.android.apps.fitness": "Google Fit",
  "com.hevy": "Hevy",
};

const signed = (x: number, digits = 1) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;

export default async function BodyPage({ searchParams }: PageProps<"/body">) {
  await connection();
  const sp = await searchParams;
  const rangeKey = RANGES.find((r) => r.value === sp.range)?.value ?? "365";
  const today = todayLocal();
  const now = nowMs();

  const history = weighIns();
  const from = rangeKey === "all"
    ? history[0]?.day ?? shiftDay(today, -364)
    : shiftDay(today, -(Number(rangeKey) - 1));
  const range = { from, to: today };
  const firstIdx = history.findIndex((w) => w.t >= dayStartMs(from));
  const inRange = firstIdx < 0 ? [] : history.slice(firstIdx);
  const latest = history.at(-1);

  // One point per day for the chart: the day's average weigh-in, and the trend as of its last one
  const byDay = new Map<string, { sum: number; n: number; trend: number }>();
  for (const w of inRange) {
    const d = byDay.get(w.day) ?? { sum: 0, n: 0, trend: w.trend };
    byDay.set(w.day, { sum: d.sum + w.kg, n: d.n + 1, trend: w.trend });
  }
  const series = fillDays(range, [...byDay].map(([day, d]) => ({ day, ...d })), (d) => d.sum / d.n)
    .map((p) => ({ ...p, avg: byDay.get(p.day)?.trend ?? null }));

  const change = inRange.length >= 2 ? inRange.at(-1)!.trend - inRange[0].trend : null;
  const weeks = inRange.length >= 2 ? (inRange.at(-1)!.t - inRange[0].t) / (7 * 86400000) : 0;
  const latestFat = [...history].reverse().find((w) => w.fat != null);
  const height = heightM();
  const bmi = latest && height ? latest.trend / height ** 2 : null;

  const composition = BODY_COMPOSITION
    .map((c) => ({ ...c, data: fillDays(range, dailySampleStats(c.type, range), (r) => r.avg) }))
    .filter((c) => c.data.some((p) => p.value != null));

  return (
    <>
      <PageHeader title="Body" subtitle="Weight, its trend and body composition">
        <SegmentedLinks options={RANGES} current={rangeKey} href={(v) => `/body?range=${v}`} />
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="Weight" icon={Scale} domain="body" value={latest ? latest.kg.toFixed(1) : "-"} unit="kg"
            footer={<span className="text-xs text-muted-foreground">
              {latest ? `Last weighed ${fmtAgo(latest.t, now)} · trend ${latest.trend.toFixed(1)} kg` : "No measurements"}
            </span>} />
          <StatTile label="Change" icon={change != null && change > 0 ? TrendingUp : TrendingDown} domain="body" value={change != null ? signed(change) : "-"} unit="kg"
            footer={<span className="text-xs text-muted-foreground">
              {change != null
                ? `Trend over this period${weeks >= 2 ? ` · ${signed(change / weeks, 2)} kg a week` : ""}`
                : "Needs two weigh-ins in this period"}
            </span>} />
          <StatTile label="Body fat" icon={Percent} domain="body" value={latestFat ? latestFat.fat!.toFixed(1) : "-"} unit="%"
            footer={<span className="text-xs text-muted-foreground">{latestFat ? `Measured ${fmtAgo(latestFat.t, now)}` : "No measurements"}</span>} />
          {bmi != null ? (
            <StatTile label="BMI" icon={Ruler} domain="body" value={bmi.toFixed(1)}
              footer={<span className="text-xs text-muted-foreground">From your trend weight · 18.5–24.9 is the usual healthy range</span>} />
          ) : (
            <StatTile label="Weigh-ins" icon={ListOrdered} domain="body" value={inRange.length} unit="this period"
              footer={<span className="text-xs text-muted-foreground">Set your height in Settings to see BMI</span>} />
          )}
        </div>

        <Panel title="Weight" icon={Scale} domain="body"
          description="Dots are weigh-ins. The line is your trend, which smooths out day-to-day swings from water and food. Click a day to open it.">
          {inRange.length ? <TrendChart data={series} label="kg" color="var(--body)" digits={1} hrefPrefix="/day/" height={300} avgLabel="Trend" />
            : <EmptyHint icon={Scale} title="No weigh-ins in this period">
                Weigh yourself with your watch&apos;s body composition, or a scale that syncs to Samsung Health or Health Connect.
              </EmptyHint>}
        </Panel>

        {composition.length > 0 && (
          <div className={composition.length > 1 ? "grid gap-4 lg:grid-cols-2" : "grid gap-4"}>
            {composition.map((c) => (
              <Panel key={c.type} title={c.label} icon={c.type === "body_fat" ? Percent : Activity} domain="body"
                description={c.unit === "%" ? "Percentage of body weight" : "Kilograms"}>
                <DailyLine data={c.data} label={c.unit} color="var(--body)" digits={1} hrefPrefix="/day/" />
              </Panel>
            ))}
          </div>
        )}

        {inRange.length > 0 && (
          <Panel title="Every weigh-in" icon={ListOrdered} domain="body" description="Most recent first">
            <div className="max-h-[30rem] overflow-auto">
              <table className="tabular w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
                  <tr>{["Date", "Time", "Weight", "Change", "Body fat", "From"].map((h) => (
                    <th key={h} className="border-b px-2 py-2 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {inRange.map((w, i) => ({ w, prev: history[firstIdx + i - 1] })).reverse().map(({ w, prev }) => (
                    <tr key={w.t} className="transition-colors hover:bg-muted/50">
                      <td className="px-2 py-1.5"><Link href={`/day/${w.day}`} className="font-medium hover:underline">{fmtDay(w.day)}{w.day.slice(0, 4) !== today.slice(0, 4) && `, ${w.day.slice(0, 4)}`}</Link></td>
                      <td className="px-2 py-1.5 text-muted-foreground">{fmtClock(w.t)}</td>
                      <td className="px-2 py-1.5 font-semibold">{w.kg.toFixed(1)} kg</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{prev ? signed(w.kg - prev.kg) : "-"}</td>
                      <td className="px-2 py-1.5">{w.fat != null ? `${w.fat.toFixed(1)}%` : "-"}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{w.source ? SOURCES[w.source] ?? w.source : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </PageBody>
    </>
  );
}
