/**
 * Per-km splits and pace for workouts with detailed speed readings. Samsung Health shares a speed
 * reading about every second during runs (but only one total distance per workout), so distance
 * along the run is rebuilt by adding up speed × time. On real runs that lands within a few metres
 * of the recorded distance, and any small gap is scaled away so splits add up to the total.
 */
import { samplesBetween, type Workout } from "./analytics";

type Reading = { t: number; bpm: number };

/** A reading counts until the next one, but a gap longer than this is treated as a pause. */
const MAX_GAP_MS = 5000;
/** Readings this far apart or less count as "detailed"; walks only get one a minute. */
const DETAILED_GAP_MS = 10000;
/** Pace is smoothed over this long so single noisy readings don't dominate the chart. */
const SMOOTH_MS = 30000;

export type Split = {
  km: number; // 1-based
  meters: number; // 1000 except the last
  seconds: number;
  pace: number; // seconds per km
  avgHr: number | null;
};

export type RunDetail = {
  splits: Split[];
  series: { km: number; t: number; pace: number | null; hr: number | null }[];
  avgPace: number;
  movingSeconds: number;
  bestSplit: Split | null; // fastest full km
  worstSplit: Split | null; // slowest full km
  bestRolling: { pace: number; at: number } | null; // fastest 30 s stretch
  halves: { first: number; second: number } | null; // pace of each half, by distance
};

export function runDetail(w: Workout, hr: Reading[]): RunDetail | null {
  if (!w.distance_m || w.distance_m < 500) return null;
  const sp = samplesBetween("speed", w.start_ms, w.end_ms + 1);
  if (sp.length < 30) return null;
  const gaps = sp.slice(1).map((s, i) => s.t - sp[i].t).sort((a, b) => a - b);
  if (gaps[Math.floor(gaps.length / 2)] > DETAILED_GAP_MS) return null;

  // Distance covered at each reading (metres), and time spent moving
  const track: { t: number; d: number; v: number }[] = [];
  let d = 0;
  let moving = 0;
  sp.forEach((s, i) => {
    track.push({ t: s.t, d, v: s.value });
    const dt = Math.min(MAX_GAP_MS, (sp[i + 1]?.t ?? s.t + 1000) - s.t) / 1000;
    d += s.value * dt;
    if (s.value > 0.5) moving += dt;
  });
  const last = sp.at(-1)!;
  track.push({ t: last.t + 1000, d, v: last.value });
  if (d < 100) return null;
  const scale = w.distance_m / d;
  if (scale < 0.85 || scale > 1.15) return null; // speed doesn't match the recorded distance
  for (const p of track) p.d *= scale;
  const total = w.distance_m;

  // When the run passed a given distance, interpolating between readings
  const timeAt = (meters: number) => {
    const i = track.findIndex((p) => p.d >= meters);
    if (i <= 0) return i === 0 ? track[0].t : track.at(-1)!.t;
    const a = track[i - 1];
    const b = track[i];
    return a.t + ((meters - a.d) / (b.d - a.d || 1)) * (b.t - a.t);
  };
  const hrBetween = (from: number, to: number) => {
    const xs = hr.filter((p) => p.t >= from && p.t < to).map((p) => p.bpm);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };

  const splits: Split[] = [];
  for (let km = 1; (km - 1) * 1000 < total - 50; km++) {
    const from = (km - 1) * 1000;
    const to = Math.min(km * 1000, total);
    const t0 = timeAt(from);
    const t1 = timeAt(to);
    const seconds = (t1 - t0) / 1000;
    splits.push({ km, meters: to - from, seconds, pace: seconds / ((to - from) / 1000), avgHr: hrBetween(t0, t1) });
  }
  const full = splits.filter((s) => s.meters >= 999);

  // Smoothed pace through the run, every 10 seconds, with heart rate alongside
  const series: RunDetail["series"] = [];
  let lo = 0;
  let sum = 0;
  let hi = 0;
  for (let t = track[0].t; t <= track.at(-1)!.t; t += 10000) {
    while (hi < sp.length && sp[hi].t <= t) sum += sp[hi++].value;
    while (lo < hi && sp[lo].t < t - SMOOTH_MS) sum -= sp[lo++].value;
    const v = hi > lo ? (sum / (hi - lo)) * scale : 0;
    const at = track.findIndex((p) => p.t > t);
    const near = hr.filter((p) => Math.abs(p.t - t) <= 5000);
    series.push({
      t,
      km: (at < 0 ? total : track[Math.max(0, at - 1)].d) / 1000,
      // Standing still has no pace; very slow stretches are clipped so they don't flatten the chart
      pace: v > 0.5 ? Math.min(1000 / v, 15 * 60) : null,
      hr: near.length ? near.reduce((a, p) => a + p.bpm, 0) / near.length : null,
    });
  }
  const fastest = series.filter((p) => p.pace != null).sort((a, b) => a.pace! - b.pace!)[0];

  const halfT = timeAt(total / 2);
  const halves = total >= 2000
    ? { first: (halfT - track[0].t) / 1000 / (total / 2000), second: (track.at(-1)!.t - halfT) / 1000 / (total / 2000) }
    : null;

  return {
    splits,
    series,
    avgPace: (track.at(-1)!.t - track[0].t) / 1000 / (total / 1000),
    movingSeconds: moving,
    bestSplit: full.length ? full.reduce((a, b) => (b.pace < a.pace ? b : a)) : null,
    worstSplit: full.length > 1 ? full.reduce((a, b) => (b.pace > a.pace ? b : a)) : null,
    bestRolling: fastest ? { pace: fastest.pace!, at: fastest.km } : null,
    halves,
  };
}
