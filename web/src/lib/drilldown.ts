/**
 * Everything the day page's "Day in detail" section shows that the rest of the page doesn't:
 * heart rate through the waking day (zones, peaks, how strain built up), the full night before,
 * and a timeline of what the day held. Built from the day's readings in one pass each.
 */
import {
  RAISED_HRR, ZONES, baselineRestingHr, dailyDistance, maxHeartRate, nights, samplesBetween, shiftDay, sleepStages, timeInZones,
  trainingLoad, trimp, workoutsBetween, type dayDetail,
} from "./analytics";
import { dailyMetric } from "./queries";
import { strainFromLoad } from "./scores";

type Reading = { t: number; bpm: number };
type Segment = { from: number; to: number };

/**
 * A reading stands for the time until the next one, capped so gaps in the data don't count. The
 * last one counts for a minute, as in the strain score's SQL, so the two always agree.
 */
const GAP_MS = 5 * 60000;
const span = (hr: Reading[], i: number, endMs: number) =>
  Math.min(GAP_MS, Math.max(0, (hr[i + 1]?.t ?? Math.min(endMs, hr[i].t + 60000)) - hr[i].t));

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Average heart rate weighted by how long each reading stands for. Workouts are recorded every
 * second and the rest of the day every few minutes, so a plain mean would mostly be the workouts.
 */
function timeWeightedMean(hr: Reading[], endMs: number) {
  let sum = 0;
  let w = 0;
  hr.forEach((p, i) => {
    const dt = span(hr, i, endMs);
    sum += p.bpm * dt;
    w += dt;
  });
  return w ? sum / w : null;
}

/**
 * Seconds in each heart-rate zone across a whole day. Unlike `timeInZones` (made for workouts,
 * where readings are a second apart) each reading here can stand for up to five minutes.
 */
function dayZones(hr: Reading[], endMs: number, maxHr: number) {
  const secs = [0, 0, 0, 0, 0];
  hr.forEach((p, i) => {
    const z = ZONES.findIndex((zz) => p.bpm / maxHr >= zz.lo && p.bpm / maxHr < zz.hi);
    if (z >= 0) secs[z] += span(hr, i, endMs) / 1000;
  });
  return secs;
}

/** Highest average heart rate over any `windowMin` minutes with at least a few readings in it. */
function peakWindow(hr: Reading[], windowMin: number): { bpm: number; at: number } | null {
  let best: { bpm: number; at: number } | null = null;
  let lo = 0;
  let sum = 0;
  for (let hi = 0; hi < hr.length; hi++) {
    sum += hr[hi].bpm;
    while (hr[hi].t - hr[lo].t > windowMin * 60000) sum -= hr[lo++].bpm;
    const n = hi - lo + 1;
    if (n >= 5 && (!best || sum / n > best.bpm)) best = { bpm: sum / n, at: hr[lo].t };
  }
  return best;
}

/** Stretches with heart rate at or above `floor`, joined across short dips, at least 3 minutes long. */
function raisedSegments(hr: Reading[], floor: number, endMs: number): Segment[] {
  const out: Segment[] = [];
  hr.forEach((p, i) => {
    if (p.bpm < floor) return;
    const to = p.t + span(hr, i, endMs);
    const last = out.at(-1);
    if (last && p.t - last.to <= 3 * 60000) last.to = to;
    else out.push({ from: p.t, to });
  });
  return out.filter((s) => s.to - s.from >= 3 * 60000);
}

export function dayDrilldown(day: string, d: ReturnType<typeof dayDetail>, untilMs: number) {
  const maxHr = maxHeartRate().value;
  const restHr = baselineRestingHr();
  const floor = restHr + RAISED_HRR * (maxHr - restHr);
  const end = Math.min(d.end, untilMs);
  const n = d.night;

  // Waking day: from midnight (or waking up, if later) to the end of the day, or now
  const wake = n && n.end_ms > d.start ? n.end_ms : d.start;
  const awakeHr = d.hr.filter((p) => p.t >= wake && p.t < end);
  const dayHr = d.hr.filter((p) => p.t >= d.start && p.t < end);

  // Strain building up over the day, sampled every 5 minutes, using the same load as the score
  const strainSeries: { t: number; strain: number }[] = [{ t: d.start, strain: 0 }];
  let load = 0;
  let nextMark = d.start + GAP_MS;
  dayHr.forEach((p, i) => {
    while (p.t >= nextMark) {
      strainSeries.push({ t: nextMark, strain: strainFromLoad(load) });
      nextMark += GAP_MS;
    }
    const bpm = Math.round(p.bpm);
    if (bpm >= floor) load += trimp(span(dayHr, i, end) / 60000, bpm, maxHr, restHr);
  });
  if (dayHr.length) strainSeries.push({ t: Math.min(end, dayHr.at(-1)!.t + GAP_MS), strain: strainFromLoad(load) });

  const awakeBpm = awakeHr.map((p) => p.bpm);
  const raised = raisedSegments(dayHr, floor, end);
  const heart = {
    awakeFrom: wake,
    lowest: awakeBpm.length ? Math.min(...awakeBpm) : null,
    average: timeWeightedMean(awakeHr, end),
    highest: awakeBpm.length ? Math.max(...awakeBpm) : null,
    peak10: peakWindow(awakeHr, 10),
    zones: dayZones(awakeHr, end, maxHr),
    // Counted the same way as the strain score, rather than from the joined-up timeline spans
    raisedMin: dayHr.reduce((a, p, i) => a + (Math.round(p.bpm) >= floor ? span(dayHr, i, end) / 60000 : 0), 0),
    raisedFloor: Math.round(floor),
    strainSeries,
    readings: dayHr.length,
  };

  // The night that ended this morning, against the 30 nights before it
  let sleep = null;
  if (n) {
    const stages = n.uids.flatMap(sleepStages).sort((a, b) => a.start_ms - b.start_ms);
    const asleepStages = stages.filter((s) => s.stage !== "awake" && s.stage !== "out_of_bed");
    const firstSleep = asleepStages[0]?.start_ms ?? n.start_ms;
    const lastSleep = asleepStages.at(-1)?.end_ms ?? n.end_ms;
    // Awakenings: awake spells of 2+ minutes between falling asleep and finally waking
    const awakenings = stages.filter((s) => (s.stage === "awake" || s.stage === "out_of_bed")
      && s.start_ms > firstSleep && s.end_ms < lastSleep && s.end_ms - s.start_ms >= 2 * 60000).length;
    // Longest unbroken sleep: consecutive sleep stages with no awake spell between them
    let longest = 0;
    let runStart: number | null = null;
    let runEnd = 0;
    for (const s of stages) {
      const awake = s.stage === "awake" || s.stage === "out_of_bed";
      if (awake || (runStart != null && s.start_ms - runEnd > 60000)) {
        if (runStart != null) longest = Math.max(longest, runEnd - runStart);
        runStart = null;
      }
      if (!awake) {
        runStart ??= s.start_ms;
        runEnd = s.end_ms;
      }
    }
    if (runStart != null) longest = Math.max(longest, runEnd - runStart);

    const nightHr = d.hr.filter((p) => p.t >= n.start_ms && p.t < n.end_ms);
    const spo2 = samplesBetween("spo2", n.start_ms, n.end_ms).map((x) => x.value);
    const prev = nights({ from: shiftDay(day, -30), to: shiftDay(day, -1) });
    const usual = (pick: (x: (typeof prev)[number]) => number) => (prev.length >= 5 ? mean(prev.map(pick)) : null);
    sleep = {
      stages,
      sessions: n.uids.length,
      hr: nightHr,
      lowestHr: nightHr.length ? Math.min(...nightHr.map((p) => p.bpm)) : null,
      averageHr: timeWeightedMean(nightHr, n.end_ms),
      spo2: spo2.length ? { avg: mean(spo2)!, min: Math.min(...spo2), n: spo2.length } : null,
      awakenings,
      longestMin: longest / 60000,
      usual: {
        asleep: usual((x) => x.asleep),
        efficiency: usual((x) => x.efficiency),
        bedMin: usual((x) => x.bedMin),
        wakeMin: usual((x) => x.wakeMin),
        deep: usual((x) => x.deep),
        rem: usual((x) => x.rem),
        light: usual((x) => x.light),
        awake: usual((x) => x.awake),
      },
    };
  }

  // Daily totals against the 30 days before
  const prevRange = { from: shiftDay(day, -30), to: shiftDay(day, -1) };
  const metric = (m: string) => ({
    value: dailyMetric(m, { from: day, to: day })[0]?.value ?? null,
    usual: mean(dailyMetric(m, prevRange).map((x) => x.value)),
  });
  const workouts = workoutsBetween(d.start, d.end).sort((a, b) => a.start_ms - b.start_ms).map((w) => {
    const hr = d.hr.filter((p) => p.t >= w.start_ms && p.t < w.end_ms);
    return { ...w, load: trainingLoad(w, maxHr, restHr), zones: timeInZones(hr, w.end_ms, maxHr) };
  });
  const activity = {
    totals: {
      steps: metric("steps"),
      distance_m: {
        value: dailyDistance({ from: day, to: day })[0]?.value ?? null,
        estimated: dailyDistance({ from: day, to: day })[0]?.estimated ?? false,
        usual: mean(dailyDistance(prevRange).map((x) => x.value)),
      },
      active_kcal: metric("active_kcal"),
      basal_kcal: metric("basal_kcal"),
      total_kcal: metric("total_kcal"),
    },
    workouts,
    timeline: {
      // Last night's sleep and any nap during the day, clipped to the day
      sleep: nights({ from: day, to: shiftDay(day, 1) })
        .filter((x) => x.start_ms < d.end && x.end_ms > d.start)
        .map((x) => ({ from: Math.max(x.start_ms, d.start), to: Math.min(x.end_ms, d.end) })),
      workouts: workouts.map((w) => ({ from: w.start_ms, to: w.end_ms, label: w.title ?? w.type })),
      raised,
    },
  };

  return { heart, sleep, activity, maxHr, end };
}
