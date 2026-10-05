/**
 * Fills a separate demo database with ~120 days of plausible watch data so the
 * dashboard and agent can be tried before real data is imported.
 *
 *   npm run seed:demo && npm run dev:demo
 */
import { ingest, type DailyMetric, type ExerciseSession, type Sample, type SleepSession } from "../src/lib/ingest";

if (!process.env.HEALTH_DB_PATH?.includes("demo")) {
  console.error("Refusing to seed: set HEALTH_DB_PATH to a demo database (npm run seed:demo does this).");
  process.exit(1);
}

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const gauss = (mean: number, sd: number) =>
  mean + sd * Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
const SRC = "demo";
const DAYS = 120;

const samples: Sample[] = [];
const daily: DailyMetric[] = [];
const sleep: SleepSession[] = [];
const exercise: ExerciseSession[] = [];

const today = new Date();
today.setHours(0, 0, 0, 0);

for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(today);
  d.setDate(today.getDate() - i);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  const workout = !weekend && rand() < 0.45;
  const lateNight = weekend || rand() < 0.15;

  // Sleep: ends this morning
  const wake = new Date(d);
  wake.setHours(weekend ? 8 : 6, Math.floor(gauss(45, 20)), 0, 0);
  const totalMin = Math.max(300, gauss(lateNight ? 390 : 445, 35));
  const bed = wake.getTime() - totalMin * 60000;
  const stages = [];
  let t = bed;
  while (t < wake.getTime()) {
    for (const [stage, mean] of [["light", 35], ["deep", lateNight ? 12 : 20], ["light", 15], ["rem", 22], ["awake", 3]] as const) {
      const end = Math.min(wake.getTime(), t + Math.max(2, gauss(mean, mean * 0.3)) * 60000);
      stages.push({ stage, start_ms: t, end_ms: end });
      t = end;
      if (t >= wake.getTime()) break;
    }
  }
  sleep.push({
    uid: `demo:sleep:${day}`, start_ms: bed, end_ms: wake.getTime(),
    score: Math.round(Math.min(98, gauss(lateNight ? 70 : 82, 6))), source: SRC, stages,
  });

  // Resting HR drifts down over the period (training effect), worse after short sleep. Like real
  // Samsung data there's no resting-HR or HRV record: the dashboard derives resting HR from the
  // overnight heart rate below.
  const rhr = gauss(62 - (DAYS - i) * 0.03 + (lateNight ? 3 : 0), 1.5);
  samples.push({ uid: `demo:spo2:${day}`, type: "spo2", start_ms: wake.getTime() - 3600000, value: Math.round(gauss(96, 1) * 10) / 10, unit: "%", source: SRC });

  // Workout timing first, so the all-day heart rate can leave a gap for it
  const run = rand() < 0.6;
  const workoutStart = d.getTime() + 18 * 3600000 + Math.floor(rand() * 60) * 60000;
  const workoutMin = Math.round(run ? gauss(48, 12) : gauss(55, 8));
  const workoutEnd = workoutStart + workoutMin * 60000;

  // All-day heart rate every 10 minutes, and every minute while asleep as the watch records it
  // (resting HR needs 10+ readings in a 30-minute window); lower while asleep
  for (let m = 0; m < 24 * 60;) {
    const ts = d.getTime() + m * 60000;
    const asleep = ts < wake.getTime() || ts > wake.getTime() + 16 * 3600000;
    m += asleep ? 1 : 10;
    if (workout && ts >= workoutStart && ts < workoutEnd) continue;
    samples.push({
      uid: `demo:hr:${ts}`, type: "heart_rate", start_ms: ts,
      value: Math.round(asleep ? gauss(rhr - 2, 2) : gauss(rhr + 14 + (m > 12 * 60 && m < 14 * 60 ? 6 : 0), 6)), unit: "bpm", source: SRC,
    });
  }

  if (workout) {
    // Dense heart rate during the workout, like the watch records: warm-up ramp, work, cool-down
    const hrs: number[] = [];
    for (let t = 0; t < workoutMin * 60; t += 10) {
      const frac = t / (workoutMin * 60);
      const base = run ? 152 : 118;
      const target = frac < 0.12 ? 95 + (base - 95) * (frac / 0.12) : frac > 0.9 ? base - (base - 105) * ((frac - 0.9) / 0.1) : base;
      const effort = run ? (Math.floor(t / 240) % 4 === 3 ? 14 : 0) : (Math.floor(t / 90) % 2 === 0 ? 18 : -8);
      const hr = Math.round(gauss(target + effort, 4));
      hrs.push(hr);
      samples.push({ uid: `demo:hrx:${workoutStart + t * 1000}`, type: "heart_rate", start_ms: workoutStart + t * 1000, value: hr, unit: "bpm", source: SRC });
    }
    exercise.push({
      uid: `demo:ex:${day}`, type: run ? "running" : "strength_training", title: null,
      start_ms: workoutStart, end_ms: workoutEnd,
      kcal: Math.round(workoutMin * (run ? 10 : 6) * gauss(1, 0.08)),
      distance_m: run ? Math.round((workoutMin / gauss(6.3, 0.35)) * 1000) : null,
      avg_hr: Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length), max_hr: Math.max(...hrs), source: SRC,
    });
    // The watch estimates VO2 max after outdoor runs; it creeps up with training
    if (run) samples.push({ uid: `demo:vo2:${day}`, type: "vo2_max", start_ms: workoutEnd, value: Math.round(gauss(44 + (DAYS - i) * 0.015, 0.5) * 10) / 10, unit: "ml/kg/min", source: SRC });
  }

  if (i % 3 === 0) {
    samples.push({ uid: `demo:weight:${day}`, type: "weight", start_ms: wake.getTime() + 600000, value: Math.round(gauss(78 - (DAYS - i) * 0.012, 0.3) * 10) / 10, unit: "kg", source: SRC });
  }

  const steps = Math.max(1500, Math.round(gauss(weekend ? 6500 : 8800, 2200) + (workout ? 3500 : 0)));
  daily.push({ day, metric: "steps", value: steps, source: SRC });
  daily.push({ day, metric: "distance_m", value: Math.round(steps * 0.76), source: SRC });
  daily.push({ day, metric: "active_kcal", value: Math.round(steps * 0.04 + (workout ? 380 : 0)), source: SRC });

}

console.log("Seeded demo data:", ingest({ samples, daily, sleep, exercise }));
