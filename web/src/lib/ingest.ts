import { getDb, transaction } from "./db";

export type Sample = {
  uid: string;
  type: string;
  start_ms: number;
  end_ms?: number | null;
  value: number;
  unit?: string | null;
  source?: string | null;
  meta?: Record<string, unknown> | null;
};

export type DailyMetric = {
  day: string;
  metric: string;
  value: number;
  source?: string | null;
};

export type SleepStage = { stage: string; start_ms: number; end_ms: number };

export type SleepSession = {
  uid: string;
  start_ms: number;
  end_ms: number;
  score?: number | null;
  source?: string | null;
  meta?: Record<string, unknown> | null;
  stages?: SleepStage[];
};

export type ExerciseSession = {
  uid: string;
  type: string;
  title?: string | null;
  start_ms: number;
  end_ms: number;
  kcal?: number | null;
  distance_m?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  source?: string | null;
  meta?: Record<string, unknown> | null;
};

export type IngestPayload = {
  samples?: Sample[];
  daily?: DailyMetric[];
  sleep?: SleepSession[];
  exercise?: ExerciseSession[];
};

const json = (v: unknown) => (v == null ? null : JSON.stringify(v));

export function ingest(payload: IngestPayload) {
  const db = getDb();
  const insSample = db.prepare(
    `INSERT OR REPLACE INTO samples (uid, type, start_ms, end_ms, value, unit, source, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insDaily = db.prepare(
    `INSERT OR REPLACE INTO daily_metrics (day, metric, value, source) VALUES (?, ?, ?, ?)`,
  );
  const insSleep = db.prepare(
    `INSERT OR REPLACE INTO sleep_sessions (uid, start_ms, end_ms, score, source, meta)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const delStages = db.prepare(`DELETE FROM sleep_stages WHERE session_uid = ?`);
  const insStage = db.prepare(
    `INSERT OR REPLACE INTO sleep_stages (session_uid, stage, start_ms, end_ms) VALUES (?, ?, ?, ?)`,
  );
  const insExercise = db.prepare(
    `INSERT OR REPLACE INTO exercise_sessions
       (uid, type, title, start_ms, end_ms, kcal, distance_m, avg_hr, max_hr, source, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const counts = { samples: 0, daily: 0, sleep: 0, exercise: 0 };

  transaction(() => {
    for (const s of payload.samples ?? []) {
      if (!Number.isFinite(s.value)) continue;
      insSample.run(
        s.uid, s.type, s.start_ms, s.end_ms ?? null, s.value,
        s.unit ?? null, s.source ?? null, json(s.meta),
      );
      counts.samples++;
    }
    for (const d of payload.daily ?? []) {
      if (!Number.isFinite(d.value)) continue;
      insDaily.run(d.day, d.metric, d.value, d.source ?? null);
      counts.daily++;
    }
    for (const s of payload.sleep ?? []) {
      insSleep.run(s.uid, s.start_ms, s.end_ms, s.score ?? null, s.source ?? null, json(s.meta));
      if (s.stages) {
        delStages.run(s.uid);
        for (const st of s.stages) insStage.run(s.uid, st.stage, st.start_ms, st.end_ms);
      }
      counts.sleep++;
    }
    for (const e of payload.exercise ?? []) {
      insExercise.run(
        e.uid, e.type, e.title ?? null, e.start_ms, e.end_ms, e.kcal ?? null,
        e.distance_m ?? null, e.avg_hr ?? null, e.max_hr ?? null, e.source ?? null, json(e.meta),
      );
      counts.exercise++;
    }
  });

  return counts;
}
