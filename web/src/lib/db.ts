import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DB_PATH =
  process.env.HEALTH_DB_PATH ?? path.join(process.cwd(), "..", "data", "health.db");

const SCHEMA = `
-- Point-in-time or interval measurements (heart rate, SpO2, weight, HRV, ...).
-- uid is source-prefixed (e.g. "hc:<record id>", "shealth:<datauuid>") so re-imports upsert.
CREATE TABLE IF NOT EXISTS samples (
  uid        TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  start_ms   INTEGER NOT NULL,
  end_ms     INTEGER,
  value      REAL NOT NULL,
  unit       TEXT,
  source     TEXT,
  meta       TEXT
);
CREATE INDEX IF NOT EXISTS samples_type_time ON samples (type, start_ms);

-- Additive metrics are stored as per-day totals, already de-duplicated across
-- phone + watch by Health Connect / Samsung Health. Summing raw step records
-- from multiple devices would double count.
CREATE TABLE IF NOT EXISTS daily_metrics (
  day     TEXT NOT NULL,           -- local date, YYYY-MM-DD
  metric  TEXT NOT NULL,           -- steps, distance_m, active_kcal, total_kcal, basal_kcal, floors, active_min
  value   REAL NOT NULL,
  source  TEXT,
  PRIMARY KEY (day, metric)
);

CREATE TABLE IF NOT EXISTS sleep_sessions (
  uid       TEXT PRIMARY KEY,
  start_ms  INTEGER NOT NULL,
  end_ms    INTEGER NOT NULL,
  score     REAL,
  source    TEXT,
  meta      TEXT
);
CREATE INDEX IF NOT EXISTS sleep_start ON sleep_sessions (start_ms);

CREATE TABLE IF NOT EXISTS sleep_stages (
  session_uid TEXT NOT NULL,
  stage       TEXT NOT NULL,       -- awake, light, deep, rem, sleeping, out_of_bed
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  PRIMARY KEY (session_uid, start_ms)
);

CREATE TABLE IF NOT EXISTS exercise_sessions (
  uid          TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  title        TEXT,
  start_ms     INTEGER NOT NULL,
  end_ms       INTEGER NOT NULL,
  kcal         REAL,
  distance_m   REAL,
  avg_hr       REAL,
  max_hr       REAL,
  source       TEXT,
  meta         TEXT
);
CREATE INDEX IF NOT EXISTS exercise_start ON exercise_sessions (start_ms);

-- GPS points recorded during a workout, from Health Connect's exercise route.
CREATE TABLE IF NOT EXISTS exercise_routes (
  session_uid TEXT NOT NULL,
  t           INTEGER NOT NULL,     -- epoch ms
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  alt_m       REAL,
  accuracy_m  REAL,                 -- horizontal accuracy
  PRIMARY KEY (session_uid, t)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    db.exec(SCHEMA);
  }
  return db;
}

export function transaction<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

/** Read-only connection for agent-issued SQL, so a bad query can never modify data. */
let readonlyDb: DatabaseSync | undefined;
export function getReadonlyDb(): DatabaseSync {
  if (!readonlyDb) {
    getDb(); // ensure file + schema exist
    readonlyDb = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return readonlyDb;
}
