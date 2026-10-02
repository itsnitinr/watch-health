import { Activity, Droplets, HeartPulse, Percent, Scale, Thermometer, Waves, Wind } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { DailyLine, HeartRangeChart, TrendChart } from "@/components/dash/charts";
import { Delta, EmptyHint, Panel, SegmentedLinks, StatTile } from "@/components/dash/primitives";
import { PageBody, PageHeader } from "@/components/page-header";
import { fillDays, shiftDay, todayLocal, withRollingAvg } from "@/lib/analytics";
import { dailySampleStats, restingHeartRate } from "@/lib/queries";

export const metadata: Metadata = { title: "Heart & body" };

const RANGES = [
  { value: "30", label: "30 days" },
  { value: "90", label: "3 months" },
  { value: "182", label: "6 months" },
  { value: "365", label: "1 year" },
];

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export default async function HeartPage({ searchParams }: PageProps<"/heart">) {
  await connection();
  const sp = await searchParams;
  const rangeKey = RANGES.find((r) => r.value === sp.range)?.value ?? "90";
  const days = Number(rangeKey);
  const today = todayLocal();
  const range = { from: shiftDay(today, -(days - 1)), to: today };
  const prev = { from: shiftDay(range.from, -days), to: shiftDay(range.from, -1) };

  const rhrData = restingHeartRate(range);
  const rhr = fillDays(range, rhrData.rows, (r) => r.value);
  const hrDaily = dailySampleStats("heart_rate", range);
  const hrv = fillDays(range, dailySampleStats("hrv_rmssd", range), (r) => r.avg);
  const spo2 = fillDays(range, dailySampleStats("spo2", range), (r) => r.avg);
  const resp = fillDays(range, dailySampleStats("respiratory_rate", range), (r) => r.avg);
  const skin = fillDays(range, dailySampleStats("skin_temperature_delta", range), (r) => r.avg);
  const weight = fillDays(range, dailySampleStats("weight", range), (r) => r.avg);
  const fat = fillDays(range, dailySampleStats("body_fat", range), (r) => r.avg);
  const has = (s: { value: number | null }[]) => s.some((p) => p.value != null);

  const rhrPrev = mean(restingHeartRate(prev).rows.map((r) => r.value));
  const hrvPrev = mean(dailySampleStats("hrv_rmssd", prev).map((r) => r.avg));
  const spo2Prev = mean(dailySampleStats("spo2", prev).map((r) => r.avg));
  const weights = weight.filter((w) => w.value != null);
  const weightChange = weights.length >= 2 ? weights.at(-1)!.value! - weights[0].value! : null;

  const rangeByDay = new Map(hrDaily.map((r) => [r.day, r]));
  const rhrByDay = new Map(rhr.map((r) => [r.day, r.value]));
  const rangeData = rhr.map(({ day }) => {
    const r = rangeByDay.get(day);
    return { day, range: r ? [r.min, r.max] as [number, number] : null, resting: rhrByDay.get(day) ?? null };
  });
  const restingLabel = rhrData.kind === "resting" ? "Resting heart rate" : "Lowest heart rate";

  return (
    <>
      <PageHeader title="Heart & body" subtitle="Heart rate, HRV, blood oxygen and body measurements">
        <SegmentedLinks options={RANGES} current={rangeKey} href={(v) => `/heart?range=${v}`} />
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label={restingLabel} icon={HeartPulse} domain="heart" value={mean(rhr.map((r) => r.value)) != null ? Math.round(mean(rhr.map((r) => r.value))!) : "-"} unit="bpm avg"
            footer={<Delta value={mean(rhr.map((r) => r.value))} reference={rhrPrev} upIsGood={false} format={(x) => `${x.toFixed(1)}`} suffix="vs previous" threshold={0.01} />} />
          <StatTile label="HRV" icon={Waves} domain="heart" value={mean(hrv.map((r) => r.value)) != null ? Math.round(mean(hrv.map((r) => r.value))!) : "-"} unit="ms avg"
            footer={<Delta value={mean(hrv.map((r) => r.value))} reference={hrvPrev} upIsGood format={(x) => `${Math.round(x)} ms`} suffix="vs previous" threshold={0.03} />} />
          <StatTile label="Blood oxygen" icon={Droplets} domain="body" value={mean(spo2.map((r) => r.value)) != null ? mean(spo2.map((r) => r.value))!.toFixed(1) : "-"} unit="% avg"
            footer={<Delta value={mean(spo2.map((r) => r.value))} reference={spo2Prev} upIsGood format={(x) => `${x.toFixed(1)} pts`} suffix="vs previous" threshold={0.005} />} />
          <StatTile label="Weight" icon={Scale} domain="body" value={weights.length ? weights.at(-1)!.value!.toFixed(1) : "-"} unit="kg"
            footer={weightChange != null ? (
              <span className="text-xs text-muted-foreground">
                {weightChange === 0 ? "No change" : `${weightChange > 0 ? "+" : ""}${weightChange.toFixed(1)} kg`} over this period
              </span>
            ) : <span className="text-xs text-muted-foreground">No measurements</span>} />
        </div>

        <Panel title="Daily heart rate" icon={Activity} domain="heart" description="The bar spans each day's lowest to highest reading; the line is your resting heart rate. Click a day to open it.">
          {hrDaily.length ? <HeartRangeChart data={rangeData} hrefPrefix="/day/" height={260} />
            : <EmptyHint icon={HeartPulse} title="No heart-rate readings in this period" />}
        </Panel>

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={restingLabel} icon={HeartPulse} domain="heart"
            description="Lower usually means better fitness and recovery. Short rises often follow poor sleep, alcohol, illness or hard training.">
            {has(rhr) ? <TrendChart data={withRollingAvg(rhr)} label="bpm" color="var(--heart)" hrefPrefix="/day/" />
              : <EmptyHint icon={HeartPulse} title="No data" />}
          </Panel>
          <Panel title="Heart rate variability" icon={Waves} domain="heart"
            description="RMSSD, measured overnight. Compare against your own trend: higher than your usual generally means well recovered.">
            {has(hrv) ? <TrendChart data={withRollingAvg(hrv)} label="ms" color="var(--heart)" hrefPrefix="/day/" />
              : <EmptyHint icon={Waves} title="No HRV readings">Samsung Health may not share HRV with Health Connect on every phone.</EmptyHint>}
          </Panel>
          <Panel title="Blood oxygen" icon={Droplets} domain="body" description="SpO₂, usually measured during sleep. 95% and above is typical.">
            {has(spo2) ? <DailyLine data={spo2} label="%" color="var(--body)" digits={1} hrefPrefix="/day/" />
              : <EmptyHint icon={Droplets} title="No blood-oxygen readings" />}
          </Panel>
          {has(resp) && (
            <Panel title="Respiratory rate" icon={Wind} domain="body" description="Breaths per minute during sleep">
              <DailyLine data={resp} label="breaths/min" color="var(--body)" digits={1} hrefPrefix="/day/" />
            </Panel>
          )}
          {has(skin) && (
            <Panel title="Skin temperature" icon={Thermometer} domain="body" description="Change from your baseline, °C">
              <DailyLine data={skin} label="°C" color="var(--body)" digits={2} hrefPrefix="/day/" />
            </Panel>
          )}
          <Panel title="Weight" icon={Scale} domain="body" description="From your watch's body composition or a connected scale">
            {has(weight) ? <TrendChart data={withRollingAvg(weight)} label="kg" color="var(--body)" digits={1} hrefPrefix="/day/" />
              : <EmptyHint icon={Scale} title="No weight measurements" />}
          </Panel>
          {has(fat) && (
            <Panel title="Body fat" icon={Percent} domain="body" description="Percentage, from body composition measurements">
              <DailyLine data={fat} label="%" color="var(--body)" digits={1} hrefPrefix="/day/" />
            </Panel>
          )}
        </div>
      </PageBody>
    </>
  );
}
