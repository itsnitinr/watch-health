import { getDb } from "./db";
import { dailyMetric, dailySampleStats, listDays, sleepNights, type Range, type SleepNight } from "./queries";
import { activityScore, energyScore, sleepScore, strainScore, type Score, type ScorePart } from "./scores";

// node:sqlite rows have a null prototype; copy them into plain objects so they can be
// passed to client components.
const all = <T>(sql: string, ...params: (string | number)[]) =>
  getDb().prepare(sql).all(...params).map((r) => ({ ...r })) as unknown as T[];
const one = <T>(sql: string, ...params: (string | number)[]) => {
  const r = getDb().prepare(sql).get(...params);
  return (r ? { ...r } : undefined) as unknown as T | undefined;
};

/** Local midnight of a YYYY-MM-DD date, as epoch ms (server runs in the user's timezone). */
export const dayStartMs = (day: string) => new Date(`${day}T00:00:00`).getTime();
export const localDay = (ms: number) => new Date(ms).toLocaleDateString("sv");
/** Current local date and time; pages call these after `connection()`, so they run per request. */
export const todayLocal = () => localDay(Date.now());
export const nowMs = () => Date.now();
export const shiftDay = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv");
};

export const SLEEP_GOAL_MIN = Number(process.env.SLEEP_GOAL_HOURS ?? 8) * 60;

// ---------------------------------------------------------------------------------------------
// Series helpers

/** Trailing mean over the last `window` days that have data (nulls are skipped, not zeroed). */
export function withRollingAvg(series: { day: string; value: number | null }[], window = 7) {
  return series.map((p, i) => {
    const vals = series.slice(Math.max(0, i - window + 1), i + 1).map((x) => x.value).filter((v): v is number => v != null);
    return { ...p, avg: vals.length >= Math.min(3, window) ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
}

/** Mean per ISO week (keyed by the week's Monday) or per month (keyed YYYY-MM-01). */
export function bucketAvg(series: { day: string; value: number | null }[], by: "week" | "month") {
  const buckets = new Map<string, number[]>();
  for (const p of series) {
    if (p.value == null) continue;
    const d = new Date(`${p.day}T12:00:00`);
    if (by === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    else d.setDate(1);
    const key = d.toLocaleDateString("sv");
    buckets.set(key, [...(buckets.get(key) ?? []), p.value]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, vs]) => ({ day, value: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length }));
}

export function fillDays<T extends { day: string }>(range: Range, rows: T[], pick: (r: T) => number | null) {
  const m = new Map(rows.map((r) => [r.day, pick(r)]));
  return listDays(range).map((day) => ({ day, value: m.get(day) ?? null }));
}

export function dataExtent() {
  const r = one<{ first: string | null; last: string | null }>(
    `SELECT MIN(d) AS first, MAX(d) AS last FROM (
       SELECT MIN(day) AS d FROM daily_metrics UNION ALL SELECT MAX(day) FROM daily_metrics
       UNION ALL SELECT date(MIN(start_ms)/1000,'unixepoch','localtime') FROM sleep_sessions
       UNION ALL SELECT date(MIN(start_ms)/1000,'unixepoch','localtime') FROM samples WHERE type = 'heart_rate')`,
  );
  return r?.first ? { first: r.first, last: r.last! } : null;
}

// ---------------------------------------------------------------------------------------------
// Distance

/**
 * Walking stride length in metres: 0.415 x height when HEIGHT_CM is set (a standard estimate),
 * otherwise 0.76 m, a typical adult stride.
 */
export const STRIDE_M = Number(process.env.HEIGHT_CM) > 0 ? (Number(process.env.HEIGHT_CM) * 0.415) / 100 : 0.76;

/**
 * Daily distance. Samsung Health only shares workout distance with Health Connect, not all-day
 * walking, so the recorded figure is often far below what the steps imply. Use whichever is
 * larger: the recorded distance, or steps x stride. `estimated` marks days where steps won.
 */
export function dailyDistance(r: Range) {
  const recorded = new Map(dailyMetric("distance_m", r).map((x) => [x.day, x.value]));
  return dailyMetric("steps", r).map(({ day, value: steps }) => {
    const fromSteps = steps * STRIDE_M;
    const rec = recorded.get(day) ?? 0;
    return { day, value: Math.max(rec, fromSteps), estimated: fromSteps > rec };
  });
}

// ---------------------------------------------------------------------------------------------
// Day drill-down

export function intradayHeartRate(fromMs: number, toMs: number) {
  return all<{ t: number; bpm: number }>(
    `SELECT start_ms AS t, value AS bpm FROM samples
     WHERE type = 'heart_rate' AND start_ms >= ? AND start_ms < ? ORDER BY start_ms`,
    fromMs, toMs,
  );
}

/** Raw readings of one sample type in a time window, oldest first. */
export function samplesBetween(type: string, fromMs: number, toMs: number) {
  return all<{ t: number; value: number }>(
    `SELECT start_ms AS t, value FROM samples WHERE type = ? AND start_ms >= ? AND start_ms < ? ORDER BY start_ms`,
    type, fromMs, toMs,
  );
}

export function sleepStages(sessionUid: string) {
  return all<{ stage: string; start_ms: number; end_ms: number }>(
    `SELECT stage, start_ms, end_ms FROM sleep_stages WHERE session_uid = ? ORDER BY start_ms`,
    sessionUid,
  );
}

export function dayDetail(day: string) {
  const r = { from: day, to: day };
  const start = dayStartMs(day);
  const end = dayStartMs(shiftDay(day, 1));
  const metric = (m: string) => dailyMetric(m, r)[0]?.value ?? null;
  const sampleAvg = (t: string) => dailySampleStats(t, r)[0] ?? null;
  const night = nights(r).at(-1) ?? null;

  return {
    steps: metric("steps"),
    distance_m: dailyDistance(r)[0]?.value ?? null,
    distanceEstimated: dailyDistance(r)[0]?.estimated ?? false,
    active_kcal: metric("active_kcal"),
    activeKcalEstimated: one<{ source: string | null }>(
      `SELECT source FROM daily_metrics WHERE day = ? AND metric = 'active_kcal'`, day,
    )?.source === "estimated",
    total_kcal: metric("total_kcal"),
    floors: metric("floors"),
    restingHr: restingHeartRate(r)[0]?.value ?? null,
    hrStats: sampleAvg("heart_rate"),
    vo2: sampleAvg("vo2_max"),
    spo2: sampleAvg("spo2"),
    weight: sampleAvg("weight"),
    night,
    stages: night ? night.uids.flatMap(sleepStages).sort((a, b) => a.start_ms - b.start_ms) : [],
    // From the previous evening (when last night's sleep started) to the end of this day
    hr: intradayHeartRate(night ? Math.min(night.start_ms, start) : start, end),
    workouts: workoutsBetween(start, end),
    start,
    end,
  };
}

// ---------------------------------------------------------------------------------------------
// Sleep

export type NightStats = SleepNight & {
  uids: string[]; // the sessions merged into this night
  score: number | null; // this dashboard's sleep score (see scores.ts)
  scoreParts: ScorePart[];
  deviceScore: number | null; // Samsung's own score, when the data source provides one
  bedOffMin: number | null; // bedtime vs the median of the previous 30 nights, minutes
  asleep: number;
  efficiency: number;
  bedMin: number; // minutes after 18:00 on the evening the night started
  wakeMin: number;
  weekend: boolean; // Friday or Saturday night
};

const minutesAfter6pm = (ms: number) => {
  const d = new Date(ms);
  const m = d.getHours() * 60 + d.getMinutes();
  return (m < 18 * 60 ? m + 24 * 60 : m) - 18 * 60;
};

/**
 * The morning a sleep session belongs to. Samsung Health often splits one night into several
 * sessions when you wake briefly; shifting by 6h puts a session that ends late in the evening
 * (e.g. 22:30 to 23:50, before waking again after midnight) with the rest of that night.
 */
const nightOf = (endMs: number) => localDay(endMs + 6 * 3600000);

const NAP_MAX_MIN = 180;
const SAME_NIGHT_GAP_MS = 2 * 3600000;

/**
 * Which of a morning's sessions make up the night. A session is part of the night if it is long
 * (3h+), overlaps the core hours (midnight to 6:00 of that morning), or lies within 2h of a
 * session that is. Everything else (an afternoon nap, an evening doze hours before bed) is a nap.
 */
function nightSessions(day: string, sessions: SleepNight[]): SleepNight[] {
  const coreStart = dayStartMs(day);
  const coreEnd = coreStart + 6 * 3600000;
  const kept = new Set(sessions.filter((x) =>
    x.total_min >= NAP_MAX_MIN || (x.start_ms < coreEnd && x.end_ms > coreStart)));
  for (let changed = kept.size > 0; changed;) {
    changed = false;
    for (const x of sessions) {
      if (kept.has(x)) continue;
      const near = [...kept].some((k) => Math.max(k.start_ms - x.end_ms, x.start_ms - k.end_ms) <= SAME_NIGHT_GAP_MS);
      if (near) { kept.add(x); changed = true; }
    }
  }
  return sessions.filter((x) => kept.has(x));
}

/**
 * One row per night: every session belonging to the same morning merged into one, naps left out
 * (see nightSessions). This is the single definition of a night used by every page and the
 * assistant, so they all agree.
 */
function mergedNights(r: Range): Omit<NightStats, "score" | "scoreParts" | "bedOffMin">[] {
  const byDay = new Map<string, SleepNight[]>();
  for (const s of sleepNights({ from: shiftDay(r.from, -1), to: r.to })) {
    const day = nightOf(s.end_ms);
    if (day < r.from || day > r.to) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  for (const [day, sessions] of byDay) {
    const kept = nightSessions(day, sessions);
    if (kept.length) byDay.set(day, kept);
    else byDay.delete(day);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, sessions]) => {
    const first = sessions[0];
    const last = sessions.at(-1)!;
    const sum = (k: "deep" | "rem" | "light" | "awake" | "total_min") => sessions.reduce((a, s) => a + s[k], 0);
    const inBed = (last.end_ms - first.start_ms) / 60000;
    // Time asleep comes from the sessions themselves, so gaps between sessions don't count as sleep
    const asleep = sum("total_min") - sum("awake");
    const evening = new Date(first.start_ms - 12 * 3600000); // bedtime after midnight still counts as previous evening
    return {
      ...first,
      day,
      uids: sessions.map((x) => x.uid),
      end_ms: last.end_ms,
      total_min: inBed,
      deep: sum("deep"),
      rem: sum("rem"),
      light: sum("light"),
      awake: sum("awake"),
      deviceScore: sessions.find((x) => x.score != null)?.score ?? null,
      asleep,
      efficiency: inBed > 0 ? asleep / inBed : 0,
      bedMin: minutesAfter6pm(first.start_ms),
      wakeMin: minutesAfter6pm(last.end_ms),
      weekend: evening.getDay() === 5 || evening.getDay() === 6,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Resting heart rate

const RHR_WINDOW_MS = 30 * 60000;
const RHR_MIN_READINGS = 10;

/**
 * Lowest 30-minute average heart rate while asleep. Samsung Health doesn't share a resting heart
 * rate with Health Connect, so it is derived the same way for every night from the watch's own
 * overnight readings (about one a minute). Needing 10+ readings per window means a single
 * glitchy low reading can't set it. Null when the night has too few readings.
 */
function nightRestingHr(n: NightStats): number | null {
  const hr = intradayHeartRate(n.start_ms, n.end_ms);
  let best: number | null = null;
  let sum = 0;
  let lo = 0;
  for (let hi = 0; hi < hr.length; hi++) {
    sum += hr[hi].bpm;
    while (hr[hi].t - hr[lo].t > RHR_WINDOW_MS) sum -= hr[lo++].bpm;
    const count = hi - lo + 1;
    if (count >= RHR_MIN_READINGS) {
      const avg = sum / count;
      if (best == null || avg < best) best = avg;
    }
  }
  return best == null ? null : Math.round(best * 10) / 10;
}

const rhrCache = new Map<string, number | null>();

/**
 * Resting heart rate per day, from the night that ended that morning. Cached per night; the key
 * includes the night's end and session ids, so a night that grows after a later sync is recomputed.
 * Today's value is never cached because heart-rate readings may still be arriving.
 */
export function restingHeartRate(r: Range): { day: string; value: number }[] {
  const today = localDay(Date.now());
  const out: { day: string; value: number }[] = [];
  for (const n of nights(r)) {
    const key = `${n.uids.join(",")}:${n.end_ms}`;
    let v = rhrCache.get(key);
    if (v === undefined) {
      v = nightRestingHr(n);
      if (n.day !== today) rhrCache.set(key, v);
    }
    if (v != null) out.push({ day: n.day, value: v });
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};

/**
 * Nights in a range, each with its sleep score. The 30 nights before the range are loaded too,
 * so every night's regularity is judged against the median bedtime of the 30 nights before it.
 */
export function nights(r: Range): NightStats[] {
  const all = mergedNights({ from: shiftDay(r.from, -30), to: r.to });
  return all.flatMap((n, i) => {
    if (n.day < r.from) return [];
    const windowStart = shiftDay(n.day, -30);
    const prior = all.slice(0, i).filter((p) => p.day >= windowStart).map((p) => p.bedMin);
    const usualBedMin = prior.length >= 5 ? median(prior) : null;
    const sc = sleepScore({
      asleep: n.asleep, inBed: n.total_min, deep: n.deep, rem: n.rem, light: n.light,
      bedMin: n.bedMin, usualBedMin, goalMin: SLEEP_GOAL_MIN,
    });
    return [{ ...n, score: sc.score, scoreParts: sc.parts, bedOffMin: usualBedMin == null ? null : Math.abs(n.bedMin - usualBedMin) }];
  });
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const stdev = (xs: number[]) => {
  const m = mean(xs);
  return m == null || xs.length < 2 ? null : Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

export function sleepSummary(ns: NightStats[]) {
  const pick = (f: (n: NightStats) => number, xs = ns) => mean(xs.map(f));
  const withStages = ns.filter((n) => n.deep + n.rem + n.light > 0);
  const stageTotal = withStages.reduce((a, n) => a + n.deep + n.rem + n.light, 0);
  const last14 = ns.slice(-14);
  const group = (xs: NightStats[]) => ({
    nights: xs.length,
    asleep: pick((n) => n.asleep, xs),
    bedMin: pick((n) => n.bedMin, xs),
    wakeMin: pick((n) => n.wakeMin, xs),
    efficiency: pick((n) => n.efficiency, xs),
    score: mean(xs.filter((n) => n.score != null).map((n) => n.score!)),
  });
  return {
    count: ns.length,
    asleep: pick((n) => n.asleep),
    inBed: pick((n) => n.total_min),
    efficiency: pick((n) => n.efficiency),
    score: mean(ns.filter((n) => n.score != null).map((n) => n.score!)),
    bedMin: pick((n) => n.bedMin),
    wakeMin: pick((n) => n.wakeMin),
    bedStdev: stdev(ns.map((n) => n.bedMin)),
    wakeStdev: stdev(ns.map((n) => n.wakeMin)),
    stagePct: stageTotal
      ? {
          deep: withStages.reduce((a, n) => a + n.deep, 0) / stageTotal,
          rem: withStages.reduce((a, n) => a + n.rem, 0) / stageTotal,
          light: withStages.reduce((a, n) => a + n.light, 0) / stageTotal,
        }
      : null,
    /** Net shortfall against the goal over the last 14 nights (surplus nights pay some back). */
    debtMin: Math.max(0, last14.reduce((a, n) => a + (SLEEP_GOAL_MIN - n.asleep), 0)),
    debtNights: last14.length,
    weekday: group(ns.filter((n) => !n.weekend)),
    weekend: group(ns.filter((n) => n.weekend)),
  };
}

// ---------------------------------------------------------------------------------------------
// Workouts & heart

export type Workout = {
  uid: string; type: string; title: string | null; start_ms: number; end_ms: number;
  kcal: number | null; distance_m: number | null; avg_hr: number | null; max_hr: number | null;
  auto: 0 | 1; // detected automatically by the watch rather than started by you
};

/**
 * Whether a workout was detected automatically. Health Connect's recording method says so
 * directly (2 = automatic, 1 = started on the watch, 3 = entered by hand); the phone app sends
 * it from now on. Older rows don't have it, so short walks and "other" activities, which is what
 * Samsung auto-detects, are treated as automatic.
 */
const WORKOUT_COLS = `uid, type, title, start_ms, end_ms, kcal, distance_m, avg_hr, max_hr,
  CASE json_extract(meta, '$.recording_method')
    WHEN 2 THEN 1 WHEN 1 THEN 0 WHEN 3 THEN 0
    ELSE (type IN ('walking', 'other_0') AND end_ms - start_ms < 45 * 60000)
  END AS auto`;

/** Workouts starting in [fromMs, toMs), newest first. Auto-detected ones only when asked. */
export function workoutsBetween(fromMs: number, toMs: number, { includeAuto = true } = {}) {
  return all<Workout>(
    `SELECT ${WORKOUT_COLS} FROM exercise_sessions
     WHERE start_ms >= ? AND start_ms < ? ORDER BY start_ms DESC`,
    fromMs, toMs,
  ).filter((w) => includeAuto || !w.auto);
}

export function workout(uid: string) {
  return one<Workout>(
    `SELECT ${WORKOUT_COLS} FROM exercise_sessions WHERE uid = ?`,
    uid,
  );
}

/**
 * Max heart rate for zones: MAX_HR from the environment, else the highest workout max HR on
 * record (ignoring implausible spikes), else 190.
 */
export function maxHeartRate(): { value: number; source: "env" | "observed" | "default" } {
  const env = Number(process.env.MAX_HR);
  if (env > 0) return { value: env, source: "env" };
  const r = one<{ m: number | null }>(`SELECT MAX(max_hr) AS m FROM exercise_sessions WHERE max_hr BETWEEN 120 AND 220`);
  return r?.m ? { value: r.m, source: "observed" } : { value: 190, source: "default" };
}

/** Typical resting HR (median of the last 60 days), used as the floor for training load. */
export function baselineRestingHr() {
  const to = localDay(Date.now());
  const vals = restingHeartRate({ from: shiftDay(to, -60), to }).map((r) => r.value).sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : 60;
}

export const ZONES = [
  { zone: 1, label: "Zone 1", name: "Very light", lo: 0, hi: 0.6 },
  { zone: 2, label: "Zone 2", name: "Light", lo: 0.6, hi: 0.7 },
  { zone: 3, label: "Zone 3", name: "Moderate", lo: 0.7, hi: 0.8 },
  { zone: 4, label: "Zone 4", name: "Hard", lo: 0.8, hi: 0.9 },
  { zone: 5, label: "Zone 5", name: "Maximum", lo: 0.9, hi: Infinity },
] as const;

export function zoneLabels(maxHr: number) {
  return ZONES.map((z) => ({
    label: z.label,
    name: z.name,
    range: z.lo === 0 ? `< ${Math.round(z.hi * maxHr)} bpm` : z.hi === Infinity ? `≥ ${Math.round(z.lo * maxHr)} bpm` : `${Math.round(z.lo * maxHr)}-${Math.round(z.hi * maxHr) - 1} bpm`,
  }));
}

/** Seconds in each zone. Each reading counts until the next one, capped at 60s to bridge gaps. */
export function timeInZones(hr: { t: number; bpm: number }[], endMs: number, maxHr: number) {
  const secs = [0, 0, 0, 0, 0];
  hr.forEach((p, i) => {
    const next = hr[i + 1]?.t ?? endMs;
    const dur = Math.min(60, Math.max(0, (next - p.t) / 1000));
    const frac = p.bpm / maxHr;
    const z = ZONES.findIndex((zz) => frac >= zz.lo && frac < zz.hi);
    if (z >= 0) secs[z] += dur;
  });
  return secs;
}

/** Banister TRIMP for `minutes` at heart rate `bpm`, weighted exponentially so hard efforts count more. */
export const trimp = (minutes: number, bpm: number, maxHr: number, restHr: number) => {
  const hrr = Math.min(1, Math.max(0, (bpm - restHr) / (maxHr - restHr)));
  return minutes * hrr * 0.64 * Math.exp(1.92 * hrr);
};

export function trainingLoad(w: Workout, maxHr: number, restHr: number) {
  if (!w.avg_hr || maxHr <= restHr) return null;
  return trimp((w.end_ms - w.start_ms) / 60000, w.avg_hr, maxHr, restHr);
}

/** Heart rate at or above this share of heart-rate reserve counts towards the day's strain. */
export const RAISED_HRR = 0.3;

/**
 * Per day, the training load from every heart-rate reading at or above RAISED_HRR, and the
 * minutes spent there. Each reading counts until the next one, capped at 5 minutes so gaps in
 * the data don't count as effort. Readings are binned by whole bpm in SQL to keep it cheap
 * over long ranges.
 */
export function dailyHeartLoad(r: Range, maxHr: number, restHr: number) {
  const floor = restHr + RAISED_HRR * (maxHr - restHr);
  const rows = all<{ day: string; bpm: number; min: number }>(
    `WITH hr AS (
       SELECT start_ms AS t, value AS bpm, LEAD(start_ms) OVER (ORDER BY start_ms) AS nt FROM samples
       WHERE type = 'heart_rate' AND start_ms >= ? AND start_ms < ?)
     SELECT date(t / 1000, 'unixepoch', 'localtime') AS day, CAST(ROUND(bpm) AS INTEGER) AS bpm,
            SUM(MIN(COALESCE(nt, t + 60000) - t, 300000)) / 60000.0 AS min
     FROM hr WHERE bpm >= ? GROUP BY day, 2`,
    dayStartMs(r.from), dayStartMs(shiftDay(r.to, 1)), floor,
  );
  const out = new Map<string, { load: number; minutes: number }>();
  if (maxHr <= restHr) return out;
  for (const x of rows) {
    const cur = out.get(x.day) ?? { load: 0, minutes: 0 };
    cur.load += trimp(x.min, x.bpm, maxHr, restHr);
    cur.minutes += x.min;
    out.set(x.day, cur);
  }
  return out;
}

export function workoutsWithZones(fromMs: number, toMs: number, maxHr: number, includeAuto = true) {
  const ws = workoutsBetween(fromMs, toMs, { includeAuto });
  const totals = [0, 0, 0, 0, 0];
  const perWorkout = new Map<string, number[]>();
  for (const w of ws) {
    const z = timeInZones(intradayHeartRate(w.start_ms, w.end_ms), w.end_ms, maxHr);
    perWorkout.set(w.uid, z);
    z.forEach((s, i) => (totals[i] += s));
  }
  return { workouts: ws, totals, perWorkout };
}

export function weeklyLoad(ws: Workout[], maxHr: number, restHr: number) {
  const weeks = new Map<string, { load: number; minutes: number; count: number }>();
  for (const w of ws) {
    const d = new Date(w.start_ms);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const key = d.toLocaleDateString("sv");
    const cur = weeks.get(key) ?? { load: 0, minutes: 0, count: 0 };
    cur.load += trainingLoad(w, maxHr, restHr) ?? 0;
    cur.minutes += (w.end_ms - w.start_ms) / 60000;
    cur.count++;
    weeks.set(key, cur);
  }
  return weeks;
}

export function personalBests() {
  type Best = { label: string; value: string | null; href: string | null; when: number | string | null };
  const fmtKm = (m: number) => `${(m / 1000).toFixed(2)} km`;
  const pace = (ms: number, m: number) => {
    const secPerKm = ms / 1000 / (m / 1000);
    return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")} /km`;
  };
  const wHref = (uid: string) => `/workouts/${encodeURIComponent(uid)}`;
  const bests: Best[] = [];

  const steps = one<{ day: string; value: number }>(`SELECT day, value FROM daily_metrics WHERE metric = 'steps' ORDER BY value DESC LIMIT 1`);
  bests.push({ label: "Most steps in a day", value: steps ? Math.round(steps.value).toLocaleString() : null, href: steps ? `/day/${steps.day}` : null, when: steps?.day ?? null });

  const longRun = one<Workout>(`SELECT * FROM exercise_sessions WHERE type = 'running' AND distance_m > 0 ORDER BY distance_m DESC LIMIT 1`);
  bests.push({ label: "Longest run", value: longRun ? fmtKm(longRun.distance_m!) : null, href: longRun ? wHref(longRun.uid) : null, when: longRun?.start_ms ?? null });

  const fastRun = one<Workout>(
    `SELECT * FROM exercise_sessions WHERE type = 'running' AND distance_m >= 5000
     ORDER BY (end_ms - start_ms) * 1.0 / distance_m ASC LIMIT 1`,
  );
  bests.push({ label: "Fastest pace (runs ≥ 5 km)", value: fastRun ? pace(fastRun.end_ms - fastRun.start_ms, fastRun.distance_m!) : null, href: fastRun ? wHref(fastRun.uid) : null, when: fastRun?.start_ms ?? null });

  const longest = one<Workout>(`SELECT * FROM exercise_sessions ORDER BY end_ms - start_ms DESC LIMIT 1`);
  bests.push({
    label: "Longest workout",
    value: longest ? `${Math.round((longest.end_ms - longest.start_ms) / 60000)} min ${longest.type.replaceAll("_", " ")}` : null,
    href: longest ? wHref(longest.uid) : null, when: longest?.start_ms ?? null,
  });

  const rhr = restingHeartRate({ from: "2000-01-01", to: localDay(Date.now()) }).reduce<{ day: string; value: number } | null>(
    (lo, x) => (lo == null || x.value < lo.value ? x : lo), null);
  bests.push({ label: "Lowest resting heart rate", value: rhr ? `${Math.round(rhr.value)} bpm` : null, href: rhr ? `/day/${rhr.day}` : null, when: rhr?.day ?? null });

  const sleep = one<{ end_ms: number; mins: number }>(
    `SELECT s.end_ms, ((s.end_ms - s.start_ms) - COALESCE(SUM(CASE WHEN st.stage IN ('awake','out_of_bed') THEN st.end_ms - st.start_ms END), 0)) / 60000.0 AS mins
     FROM sleep_sessions s LEFT JOIN sleep_stages st ON st.session_uid = s.uid GROUP BY s.uid ORDER BY mins DESC LIMIT 1`,
  );
  bests.push({
    label: "Longest sleep",
    value: sleep ? `${Math.floor(sleep.mins / 60)}h ${String(Math.round(sleep.mins % 60)).padStart(2, "0")}m` : null,
    href: sleep ? `/day/${localDay(sleep.end_ms)}` : null, when: sleep ? localDay(sleep.end_ms) : null,
  });

  return bests;
}

// ---------------------------------------------------------------------------------------------
// Weight

/** Body composition readings shown on the Weight page, when there are any. */
export const BODY_COMPOSITION = [
  { type: "body_fat", label: "Body fat", unit: "%" },
  { type: "skeletal_muscle_mass", label: "Skeletal muscle", unit: "kg" },
  { type: "lean_body_mass", label: "Lean mass", unit: "kg" },
  { type: "body_water_mass", label: "Body water", unit: "kg" },
  { type: "bone_mass", label: "Bone mass", unit: "kg" },
] as const;

export type WeighIn = { t: number; day: string; kg: number; fat: number | null; source: string | null; trend: number };

/** Days for the trend to mostly catch up with a new level of weight. */
const TREND_TAU_DAYS = 10;

/**
 * Every weigh-in, oldest first, with body fat from the same measurement and a smoothed trend.
 * Daily weight swings by a kilo or more with water and food, so the trend is what to read: an
 * exponential moving average weighted by the time between weigh-ins (about 10% per day when
 * weighing daily, and nearly the new reading after a long gap).
 */
export function weighIns(): WeighIn[] {
  const rows = all<{ t: number; kg: number; fat: number | null; source: string | null }>(
    `SELECT w.start_ms AS t, AVG(w.value) AS kg, MAX(w.source) AS source,
       (SELECT AVG(f.value) FROM samples f WHERE f.type = 'body_fat' AND f.start_ms = w.start_ms) AS fat
     FROM samples w WHERE w.type = 'weight' GROUP BY w.start_ms ORDER BY w.start_ms`,
  );
  let trend: number | null = null;
  let prevT = 0;
  return rows.map((r) => {
    const alpha = trend == null ? 1 : 1 - Math.exp(-(r.t - prevT) / 86400000 / TREND_TAU_DAYS);
    trend = trend == null ? r.kg : trend + alpha * (r.kg - trend);
    prevT = r.t;
    return { ...r, day: localDay(r.t), trend };
  });
}

/** Height in metres, from HEIGHT_CM or the latest synced height. */
export function heightM(): number | null {
  if (Number(process.env.HEIGHT_CM) > 0) return Number(process.env.HEIGHT_CM) / 100;
  return one<{ value: number }>(`SELECT value FROM samples WHERE type = 'height' ORDER BY start_ms DESC LIMIT 1`)?.value ?? null;
}

// ---------------------------------------------------------------------------------------------
// Today view

export const GOALS = {
  steps: Number(process.env.STEPS_GOAL ?? 10000),
  sleepMin: SLEEP_GOAL_MIN,
  exerciseMin: Number(process.env.EXERCISE_GOAL_MIN ?? 30),
};

const avgOf = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Your usual values: averages over the 30 days before `day` (the day itself excluded). */
export function baselines(day: string) {
  const r = { from: shiftDay(day, -30), to: shiftDay(day, -1) };
  const lastWeight = one<{ value: number }>(
    `SELECT value FROM samples WHERE type = 'weight' AND start_ms < ? ORDER BY start_ms DESC LIMIT 1`, dayStartMs(day),
  );
  return {
    steps: avgOf(dailyMetric("steps", r).map((x) => x.value)),
    distance_m: avgOf(dailyDistance(r).map((x) => x.value)),
    active_kcal: avgOf(dailyMetric("active_kcal", r).map((x) => x.value)),
    asleep: avgOf(nights(r).map((n) => n.asleep)),
    restingHr: avgOf(restingHeartRate(r).map((x) => x.value)),
    spo2: avgOf(dailySampleStats("spo2", r).map((x) => x.avg)),
    weight: lastWeight?.value ?? null,
  };
}

/** Values for the `n` days ending on `day`, for sparklines and the week strip. */
export function recentSeries(day: string, n = 7) {
  const r = { from: shiftDay(day, -(n - 1)), to: day };
  return {
    days: listDays(r),
    steps: fillDays(r, dailyMetric("steps", r), (x) => x.value),
    distance: fillDays(r, dailyDistance(r), (x) => x.value),
    activeKcal: fillDays(r, dailyMetric("active_kcal", r), (x) => x.value),
    restingHr: fillDays(r, restingHeartRate(r), (x) => x.value),
    spo2: fillDays(r, dailySampleStats("spo2", r), (x) => x.avg),
    weight: fillDays(r, dailySampleStats("weight", r), (x) => x.avg),
    nights: nights(r),
    exerciseMin: fillDays(r,
      listDays(r).map((d) => ({
        day: d,
        min: workoutsBetween(dayStartMs(d), dayStartMs(shiftDay(d, 1))).reduce((a, w) => a + (w.end_ms - w.start_ms) / 60000, 0),
      })),
      (x) => x.min),
  };
}

/** Days (local dates) that have any data, for the date picker. */
export function dataDays(limitDays = 800) {
  const since = Date.now() - limitDays * 86400000;
  return all<{ day: string }>(
    `SELECT day FROM daily_metrics WHERE day >= date(? / 1000, 'unixepoch', 'localtime')
     UNION SELECT date(end_ms / 1000, 'unixepoch', 'localtime') FROM sleep_sessions WHERE end_ms >= ?
     UNION SELECT date(start_ms / 1000, 'unixepoch', 'localtime') FROM samples WHERE type = 'weight' AND start_ms >= ?`,
    since, since, since,
  ).map((r) => r.day);
}

export function latestDataDay() {
  return one<{ day: string | null }>(
    `SELECT MAX(d) AS day FROM (
       SELECT MAX(day) AS d FROM daily_metrics
       UNION ALL SELECT date(MAX(end_ms) / 1000, 'unixepoch', 'localtime') FROM sleep_sessions
       UNION ALL SELECT date(MAX(start_ms) / 1000, 'unixepoch', 'localtime') FROM samples)`,
  )?.day ?? null;
}

/** Latest VO2 max readings (Samsung measures it during outdoor runs/walks), oldest first. */
export function vo2History(beforeDay: string, n = 12) {
  return all<{ t: number; value: number }>(
    `SELECT start_ms AS t, value FROM samples WHERE type = 'vo2_max' AND start_ms < ? ORDER BY start_ms DESC LIMIT ?`,
    dayStartMs(shiftDay(beforeDay, 1)), n,
  ).reverse();
}

// ---------------------------------------------------------------------------------------------
// Daily scores

export type DayScores = { day: string; sleep: Score | null; energy: Score; strain: Score | null; activity: Score };

/**
 * Sleep, Energy, Strain and Activity scores for every day in the range, computed in one pass from data
 * loaded once (nights, resting heart rate, steps and workouts, plus the history each score
 * needs before the range starts). Strain reads every heart-rate reading in the range, which is
 * slow over months, so it is only computed when asked for.
 */
export function dailyScores(r: Range, { withStrain = false } = {}): Map<string, DayScores> {
  const hist = { from: shiftDay(r.from, -30), to: r.to };
  const ns = new Map(nights({ from: shiftDay(r.from, -7), to: r.to }).map((n) => [n.day, n]));
  const rhr = new Map(restingHeartRate(hist).map((x) => [x.day, x.value]));
  const steps = new Map(dailyMetric("steps", r).map((x) => [x.day, x.value]));
  const maxHr = maxHeartRate().value;
  const restHr = baselineRestingHr();
  const load = new Map<string, number>();
  const exMin = new Map<string, number>();
  const workoutCount = new Map<string, number>();
  const heart = withStrain ? dailyHeartLoad(r, maxHr, restHr) : new Map<string, { load: number; minutes: number }>();
  const worn = new Set(!withStrain ? [] : all<{ day: string }>(
    `SELECT DISTINCT date(start_ms / 1000, 'unixepoch', 'localtime') AS day FROM samples
     WHERE type = 'heart_rate' AND start_ms >= ? AND start_ms < ?`,
    dayStartMs(r.from), dayStartMs(shiftDay(r.to, 1)),
  ).map((x) => x.day));
  for (const w of workoutsBetween(dayStartMs(shiftDay(r.from, -28)), dayStartMs(shiftDay(r.to, 1)))) {
    const d = localDay(w.start_ms);
    load.set(d, (load.get(d) ?? 0) + (trainingLoad(w, maxHr, restHr) ?? 0));
    exMin.set(d, (exMin.get(d) ?? 0) + (w.end_ms - w.start_ms) / 60000);
    workoutCount.set(d, (workoutCount.get(d) ?? 0) + 1);
  }
  const sumDays = (m: Map<string, number>, end: string, n: number) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += m.get(shiftDay(end, -i)) ?? 0;
    return t;
  };

  const out = new Map<string, DayScores>();
  for (const day of listDays(r)) {
    const night = ns.get(day) ?? null;
    const prevRhr = Array.from({ length: 30 }, (_, i) => rhr.get(shiftDay(day, -1 - i))).filter((v): v is number => v != null);
    const week = Array.from({ length: 7 }, (_, i) => ns.get(shiftDay(day, -i))?.asleep).filter((v): v is number => v != null);
    const yesterday = shiftDay(day, -1);
    out.set(day, {
      day,
      sleep: night ? { score: night.score, parts: night.scoreParts } : null,
      energy: energyScore({
        sleepScore: night?.score ?? null,
        restingHr: rhr.get(day) ?? null,
        restingHrUsual: prevRhr.length >= 7 ? prevRhr.reduce((a, b) => a + b, 0) / prevRhr.length : null,
        avgAsleep7: week.length >= 3 ? week.reduce((a, b) => a + b, 0) / week.length : null,
        goalMin: SLEEP_GOAL_MIN,
        loadYesterday: load.get(yesterday) ?? 0,
        loadAcute: sumDays(load, yesterday, 7) / 7,
        loadChronic: sumDays(load, yesterday, 28) / 28,
        bedOffMin: night?.bedOffMin ?? null,
      }),
      // No heart-rate readings and no workouts means the watch wasn't worn, not a zero-strain day
      strain: withStrain && (worn.has(day) || workoutCount.has(day)) ? strainScore({
        hrLoad: heart.get(day)?.load ?? 0,
        workoutLoad: load.get(day) ?? 0,
        workoutCount: workoutCount.get(day) ?? 0,
        workoutMin: exMin.get(day) ?? 0,
        raisedMin: heart.get(day)?.minutes ?? 0,
      }) : null,
      activity: activityScore({
        steps: steps.get(day) ?? null,
        stepGoal: GOALS.steps,
        exerciseMin: exMin.get(day) ?? 0,
        exerciseGoal: GOALS.exerciseMin,
        weekExerciseMin: sumDays(exMin, day, 7),
      }),
    });
  }
  return out;
}
