/**
 * Import a Samsung Health data export (Samsung Health → Settings → Download personal data).
 * Copy the exported folder from the phone (Download/Samsung Health/samsunghealth_*) and run:
 *
 *   npm run import:shealth -- /path/to/samsunghealth_xxx
 *
 * Re-running is safe: rows are keyed by Samsung's datauuid and upserted.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { ingest, type DailyMetric, type ExerciseSession, type Sample, type SleepSession } from "../src/lib/ingest";

type Row = Record<string, string>;

const SOURCE = "samsung_health_export";

const SLEEP_STAGES: Record<string, string> = {
  "40001": "awake",
  "40002": "light",
  "40003": "deep",
  "40004": "rem",
};

const EXERCISE_TYPES: Record<string, string> = {
  "1001": "walking",
  "1002": "running",
  "11007": "cycling",
  "13001": "hiking",
  "14001": "swimming",
};

/** Samsung CSVs have a metadata line, then a header whose columns are namespaced
 *  (e.g. "com.samsung.health.heart_rate.start_time"). We keep only the last segment. */
function readCsv(file: string): Row[] {
  const text = fs.readFileSync(file, "utf8");
  const body = text.slice(text.indexOf("\n") + 1);
  const records: string[][] = parse(body, { relax_column_count: true, skip_empty_lines: true, bom: true });
  if (records.length === 0) return [];
  const header = records[0].map((h) => h.split(".").pop()!.trim());
  return records.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** Samsung writes either epoch millis or "YYYY-MM-DD HH:MM:SS.sss" in UTC. */
function ms(v: string | undefined): number | null {
  if (!v) return null;
  if (/^\d{11,}$/.test(v)) return Number(v);
  const t = Date.parse(v.replace(" ", "T") + "Z");
  return Number.isNaN(t) ? null : t;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const uid = (r: Row, type: string) => `shealth:${r.datauuid || `${type}:${r.start_time}`}`;

/** Adds one sample per configured column for every row that has a timestamp + value. */
function samplesFrom(rows: Row[], cols: Record<string, { type: string; unit: string }>): Sample[] {
  const out: Sample[] = [];
  for (const r of rows) {
    const start = ms(r.start_time) ?? ms(r.create_time);
    if (start == null) continue;
    for (const [col, { type, unit }] of Object.entries(cols)) {
      const value = num(r[col]);
      if (value == null || value === 0) continue;
      out.push({ uid: `${uid(r, type)}:${type}`, type, start_ms: start, end_ms: ms(r.end_time), value, unit, source: SOURCE });
    }
  }
  return out;
}

type Handler = (rows: Row[], acc: Acc) => void;
type Acc = { samples: Sample[]; daily: DailyMetric[]; sleep: Map<string, SleepSession>; stages: Row[]; exercise: ExerciseSession[] };

// Keyed by the file-name prefix before the trailing ".<timestamp>.csv".
const HANDLERS: Record<string, Handler> = {
  "com.samsung.shealth.tracker.heart_rate": (rows, acc) => {
    acc.samples.push(...samplesFrom(rows, { heart_rate: { type: "heart_rate", unit: "bpm" } }));
  },
  "com.samsung.shealth.tracker.oxygen_saturation": (rows, acc) => {
    acc.samples.push(...samplesFrom(rows, { spo2: { type: "spo2", unit: "%" } }));
  },
  "com.samsung.shealth.stress": (rows, acc) => {
    acc.samples.push(...samplesFrom(rows, { score: { type: "stress", unit: "score" } }));
  },
  "com.samsung.health.weight": (rows, acc) => {
    acc.samples.push(
      ...samplesFrom(rows, {
        weight: { type: "weight", unit: "kg" },
        body_fat: { type: "body_fat", unit: "%" },
        skeletal_muscle_mass: { type: "skeletal_muscle_mass", unit: "kg" },
        basal_metabolic_rate: { type: "bmr", unit: "kcal" },
      }),
    );
  },
  "com.samsung.shealth.tracker.pedometer_day_summary": (rows, acc) => {
    // One row per device per day (phone, watch, merged). The merged row has the highest count.
    const best = new Map<string, Row>();
    for (const r of rows) {
      const t = ms(r.day_time);
      if (t == null) continue;
      const day = new Date(t).toISOString().slice(0, 10);
      if ((num(r.step_count) ?? 0) > (num(best.get(day)?.step_count) ?? -1)) best.set(day, r);
    }
    for (const [day, r] of best) {
      const steps = num(r.step_count);
      const dist = num(r.distance);
      if (steps != null) acc.daily.push({ day, metric: "steps", value: steps, source: SOURCE });
      if (dist != null) acc.daily.push({ day, metric: "distance_m", value: dist, source: SOURCE });
    }
  },
  "com.samsung.shealth.activity.day_summary": (rows, acc) => {
    for (const r of rows) {
      const t = ms(r.day_time);
      if (t == null) continue;
      const day = new Date(t).toISOString().slice(0, 10);
      const kcal = num(r.calorie);
      const activeMs = num(r.active_time);
      if (kcal != null) acc.daily.push({ day, metric: "active_kcal", value: kcal, source: SOURCE });
      if (activeMs != null) acc.daily.push({ day, metric: "active_min", value: Math.round(activeMs / 60000), source: SOURCE });
    }
  },
  "com.samsung.shealth.sleep": (rows, acc) => {
    for (const r of rows) {
      const start = ms(r.start_time);
      const end = ms(r.end_time);
      if (start == null || end == null || !r.datauuid) continue;
      acc.sleep.set(r.datauuid, {
        uid: `shealth:${r.datauuid}`,
        start_ms: start,
        end_ms: end,
        score: num(r.sleep_score),
        source: SOURCE,
        meta: { efficiency: num(r.efficiency), mental_recovery: num(r.mental_recovery), physical_recovery: num(r.physical_recovery) },
        stages: [],
      });
    }
  },
  "com.samsung.health.sleep_stage": (rows, acc) => {
    acc.stages.push(...rows); // attached to sessions after all files are read
  },
  "com.samsung.shealth.exercise": (rows, acc) => {
    for (const r of rows) {
      const start = ms(r.start_time);
      const end = ms(r.end_time);
      if (start == null || end == null) continue;
      const code = r.exercise_type;
      acc.exercise.push({
        uid: uid(r, "exercise"),
        type: EXERCISE_TYPES[code] ?? `samsung_${code}`,
        title: r.title || null,
        start_ms: start,
        end_ms: end,
        kcal: num(r.calorie),
        distance_m: num(r.distance),
        avg_hr: num(r.mean_heart_rate),
        max_hr: num(r.max_heart_rate),
        source: SOURCE,
      });
    }
  },
};

function main() {
  const dir = process.argv[2];
  if (!dir || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    console.error("Usage: npm run import:shealth -- <path to samsunghealth_* export folder>");
    process.exit(1);
  }

  const acc: Acc = { samples: [], daily: [], sleep: new Map(), stages: [], exercise: [] };
  const handled: string[] = [];
  const skipped: string[] = [];

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
    const prefix = file.replace(/\.\d+\.csv$/, "").replace(/\.csv$/, "");
    const handler = HANDLERS[prefix];
    if (!handler) {
      skipped.push(prefix);
      continue;
    }
    const rows = readCsv(path.join(dir, file));
    handler(rows, acc);
    handled.push(`${prefix} (${rows.length} rows)`);
  }

  let orphanStages = 0;
  for (const r of acc.stages) {
    const session = acc.sleep.get(r.sleep_id);
    const start = ms(r.start_time);
    const end = ms(r.end_time);
    if (!session || start == null || end == null) {
      orphanStages++;
      continue;
    }
    session.stages!.push({ stage: SLEEP_STAGES[r.stage] ?? `samsung_${r.stage}`, start_ms: start, end_ms: end });
  }

  const counts = ingest({ samples: acc.samples, daily: acc.daily, sleep: [...acc.sleep.values()], exercise: acc.exercise });

  console.log("Imported:", counts);
  console.log("\nFiles used:\n  " + handled.join("\n  "));
  if (orphanStages) console.log(`\n${orphanStages} sleep stage rows had no matching sleep session`);
  console.log(`\nFiles not imported (${skipped.length}):\n  ` + skipped.join("\n  "));
}

main();
