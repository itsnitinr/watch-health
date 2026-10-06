import { getDb } from "./db";

/**
 * Personal settings, edited on the Settings page and saved in the database. Each one falls
 * back to its environment variable (how they were set before the page existed), then to a
 * default. `fallback: null` means "work it out from your data".
 */
export const SETTINGS = {
  stepsGoal: {
    label: "Daily steps", unit: "steps", env: "STEPS_GOAL", fallback: 10000, min: 1000, max: 50000, step: 500,
    help: "The steps ring on Today, and the goal line on Activity",
  },
  sleepGoalHours: {
    label: "Nightly sleep", unit: "hours", env: "SLEEP_GOAL_HOURS", fallback: 8, min: 4, max: 12, step: 0.25,
    help: "The sleep ring, sleep score and sleep debt",
  },
  exerciseGoalMin: {
    label: "Daily exercise", unit: "min", env: "EXERCISE_GOAL_MIN", fallback: 30, min: 5, max: 300, step: 5,
    help: "The exercise ring and activity score",
  },
  heightCm: {
    label: "Height", unit: "cm", env: "HEIGHT_CM", fallback: null, min: 100, max: 250, step: 0.5,
    help: "For BMI, and walking distance from steps. Empty uses a height synced from your phone, if any",
  },
  maxHr: {
    label: "Max heart rate", unit: "bpm", env: "MAX_HR", fallback: null, min: 120, max: 230, step: 1,
    help: "For heart-rate zones and training load. Empty uses the highest you've recorded in a workout",
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

function saved(key: SettingKey): number | null {
  const r = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return r ? Number(r.value) : null;
}

function fromEnv(key: SettingKey): number | null {
  const v = Number(process.env[SETTINGS[key].env]);
  return v > 0 ? v : null;
}

/** The value in effect, and where it came from. */
export function settingWithSource(key: SettingKey): { value: number | null; source: "saved" | "env" | "default" } {
  const s = saved(key);
  if (s != null) return { value: s, source: "saved" };
  const e = fromEnv(key);
  if (e != null) return { value: e, source: "env" };
  return { value: SETTINGS[key].fallback, source: "default" };
}

export const setting = (key: SettingKey) => settingWithSource(key).value;

/** What a setting goes back to when its saved value is cleared. */
export const settingFallback = (key: SettingKey) => fromEnv(key) ?? SETTINGS[key].fallback;

/** Save values; null clears a saved value so the setting falls back again. */
export function saveSettings(values: Partial<Record<SettingKey, number | null>>) {
  const db = getDb();
  const put = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  const del = db.prepare(`DELETE FROM settings WHERE key = ?`);
  for (const [key, value] of Object.entries(values)) {
    if (value == null) del.run(key);
    else put.run(key, String(value));
  }
}
