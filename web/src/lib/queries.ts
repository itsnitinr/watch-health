import { getDb } from "./db";

// All day bucketing uses the machine's local timezone, which is the user's timezone
// since this runs on their own computer. Sleep is attributed to the day you woke up.
const LOCAL_DAY = (col: string) => `date(${col} / 1000, 'unixepoch', 'localtime')`;

export type Range = { from: string; to: string }; // inclusive local dates, YYYY-MM-DD

export function rangeFromDays(days: number): Range {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: fmt(from), to: fmt(to) };
}

export function listDays({ from, to }: Range): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

type Row = Record<string, unknown>;
// node:sqlite rows have a null prototype; copy them into plain objects so they can be
// passed to client components.
const all = <T>(sql: string, ...params: (string | number)[]) =>
  getDb().prepare(sql).all(...params).map((r) => ({ ...r })) as unknown as T[];

export function dailyMetric(metric: string, r: Range) {
  return all<{ day: string; value: number }>(
    `SELECT day, value FROM daily_metrics WHERE metric = ? AND day BETWEEN ? AND ? ORDER BY day`,
    metric, r.from, r.to,
  );
}

/** Daily avg/min/max of a sample type (heart_rate, spo2, weight, hrv_rmssd, ...). */
/** Epoch-ms bounds of a range of local dates, so queries can use the (type, start_ms) index. */
function msBounds({ from, to }: Range) {
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return [new Date(`${from}T00:00:00`).getTime(), end.getTime()] as const;
}

export function dailySampleStats(type: string, r: Range) {
  const [fromMs, toMs] = msBounds(r);
  return all<{ day: string; avg: number; min: number; max: number; n: number }>(
    `SELECT ${LOCAL_DAY("start_ms")} AS day, AVG(value) AS avg, MIN(value) AS min, MAX(value) AS max, COUNT(*) AS n
     FROM samples WHERE type = ? AND start_ms >= ? AND start_ms < ?
     GROUP BY day ORDER BY day`,
    type, fromMs, toMs,
  );
}

export type SleepNight = {
  day: string;
  uid: string;
  start_ms: number;
  end_ms: number;
  score: number | null;
  total_min: number;
  deep: number;
  rem: number;
  light: number;
  awake: number;
};

export function sleepNights(r: Range): SleepNight[] {
  return all<SleepNight>(
    `SELECT ${LOCAL_DAY("s.end_ms")} AS day, s.uid, s.start_ms, s.end_ms, s.score,
            (s.end_ms - s.start_ms) / 60000.0 AS total_min,
            COALESCE(SUM(CASE WHEN st.stage = 'deep'  THEN st.end_ms - st.start_ms END), 0) / 60000.0 AS deep,
            COALESCE(SUM(CASE WHEN st.stage = 'rem'   THEN st.end_ms - st.start_ms END), 0) / 60000.0 AS rem,
            COALESCE(SUM(CASE WHEN st.stage IN ('light', 'sleeping') THEN st.end_ms - st.start_ms END), 0) / 60000.0 AS light,
            COALESCE(SUM(CASE WHEN st.stage IN ('awake', 'out_of_bed') THEN st.end_ms - st.start_ms END), 0) / 60000.0 AS awake
     FROM sleep_sessions s LEFT JOIN sleep_stages st ON st.session_uid = s.uid
     WHERE ${LOCAL_DAY("s.end_ms")} BETWEEN ? AND ?
     GROUP BY s.uid ORDER BY s.end_ms`,
    r.from, r.to,
  );
}

export function exercises(r: Range) {
  return all<{
    uid: string; type: string; title: string | null; start_ms: number; end_ms: number;
    kcal: number | null; distance_m: number | null; avg_hr: number | null; max_hr: number | null;
  }>(
    `SELECT uid, type, title, start_ms, end_ms, kcal, distance_m, avg_hr, max_hr
     FROM exercise_sessions WHERE ${LOCAL_DAY("start_ms")} BETWEEN ? AND ? ORDER BY start_ms DESC`,
    r.from, r.to,
  );
}

/** Which sample types exist, so the dashboard only renders charts that have data. */
export function availableSampleTypes() {
  return all<{ type: string; unit: string | null; n: number; last_ms: number }>(
    `SELECT type, MAX(unit) AS unit, COUNT(*) AS n, MAX(start_ms) AS last_ms FROM samples GROUP BY type ORDER BY type`,
  );
}

export function dataCoverage() {
  const db = getDb();
  const one = (sql: string) => db.prepare(sql).get() as Row;
  return {
    samples: one(`SELECT COUNT(*) AS n, MIN(start_ms) AS first, MAX(start_ms) AS last FROM samples`),
    daily: one(`SELECT COUNT(*) AS n, MIN(day) AS first, MAX(day) AS last FROM daily_metrics`),
    sleep: one(`SELECT COUNT(*) AS n, MIN(start_ms) AS first, MAX(end_ms) AS last FROM sleep_sessions`),
    exercise: one(`SELECT COUNT(*) AS n, MIN(start_ms) AS first, MAX(start_ms) AS last FROM exercise_sessions`),
    lastAndroidSync: (db.prepare(`SELECT value FROM sync_state WHERE key = 'last_android_sync'`).get() as Row | undefined)?.value as string | undefined,
  };
}
