/**
 * Sleep, Energy and Activity scores.
 *
 * Every score is 0-100 and is a weighted average of a few named parts, each itself 0-100, so
 * the UI can always show why a score is what it is. Personal parts are judged against your own
 * recent norm (30-day usual) rather than population values. A part that can't be computed
 * (e.g. no sleep stages that night) is left out and the remaining weights are rescaled.
 *
 * These are this dashboard's own heuristics, informed by published sleep and training-load
 * research, not Samsung's (unpublished) algorithms, and not medical measures.
 */

export type ScorePart = {
  key: string;
  label: string;
  weight: number;
  score: number | null; // null = not enough data, excluded
  detail: string;
};

export type Score = { score: number | null; parts: ScorePart[]; capped?: boolean };

/** Piecewise-linear interpolation through (x, y) points sorted by x; flat beyond the ends. */
export function interp(x: number, points: [number, number][]): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return points.at(-1)![1];
}

export function combine(parts: ScorePart[]): Score {
  const used = parts.filter((p) => p.score != null);
  const w = used.reduce((a, p) => a + p.weight, 0);
  return {
    score: w ? Math.round(used.reduce((a, p) => a + p.weight * p.score!, 0) / w) : null,
    parts: parts.map((p) => ({ ...p, score: p.score == null ? null : Math.round(p.score) })),
  };
}

export const BANDS = [
  { min: 85, label: "Excellent", tone: "good" },
  { min: 70, label: "Good", tone: "good" },
  { min: 55, label: "Fair", tone: "warn" },
  { min: 0, label: "Low", tone: "bad" },
] as const;
export const band = (score: number) => BANDS.find((b) => score >= b.min)!;

const hm = (min: number) => `${Math.floor(Math.round(min) / 60)}h ${String(Math.round(min) % 60).padStart(2, "0")}m`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** How far a time-of-night is from the usual one (both minutes after 18:00) mapped to 0-100. */
const TIMING: [number, number][] = [[0, 100], [30, 95], [60, 80], [90, 60], [150, 35], [240, 15]];

// ---------------------------------------------------------------------------------------------

export type SleepInput = {
  asleep: number; // minutes
  inBed: number; // minutes
  deep: number;
  rem: number;
  light: number;
  bedMin: number; // minutes after 18:00
  usualBedMin: number | null; // median of the previous 30 nights
  goalMin: number;
};

export function sleepScore(n: SleepInput): Score {
  const staged = n.deep + n.rem + n.light;
  const hasStages = staged > 0 && n.deep + n.rem > 0;
  const deepShare = hasStages ? n.deep / staged : 0;
  const remShare = hasStages ? n.rem / staged : 0;
  const eff = n.inBed > 0 ? n.asleep / n.inBed : 0;
  const off = n.usualBedMin == null ? null : Math.abs(n.bedMin - n.usualBedMin);
  return combine([
    {
      key: "duration", label: "Duration", weight: 35,
      score: interp(n.asleep / n.goalMin, [[0.5, 10], [0.625, 35], [0.75, 60], [0.875, 82], [1, 100]]),
      detail: `${hm(n.asleep)} asleep of a ${hm(n.goalMin)} goal`,
    },
    {
      key: "efficiency", label: "Efficiency", weight: 15,
      score: interp(eff, [[0.65, 25], [0.75, 55], [0.85, 85], [0.9, 100]]),
      detail: `${pct(eff)} of time in bed spent asleep`,
    },
    {
      key: "deep", label: "Deep sleep", weight: 15,
      score: hasStages ? interp(deepShare, [[0.05, 15], [0.1, 55], [0.13, 80], [0.16, 100]]) : null,
      detail: hasStages ? `${hm(n.deep)}, ${pct(deepShare)} of sleep` : "No stage data",
    },
    {
      key: "rem", label: "REM sleep", weight: 15,
      score: hasStages ? interp(remShare, [[0.08, 15], [0.14, 55], [0.18, 80], [0.21, 100]]) : null,
      detail: hasStages ? `${hm(n.rem)}, ${pct(remShare)} of sleep` : "No stage data",
    },
    {
      key: "regularity", label: "Regularity", weight: 20,
      score: off == null ? null : interp(off, TIMING),
      detail: off == null ? "Not enough history yet" : off < 15 ? "Bedtime right on your usual" : `Bedtime ${Math.round(off)} min off your usual`,
    },
  ]);
}

// ---------------------------------------------------------------------------------------------

export type EnergyInput = {
  sleepScore: number | null; // last night
  restingHr: number | null; // this morning
  restingHrUsual: number | null; // mean of the previous 30 days
  avgAsleep7: number | null; // minutes, last 7 nights including last night
  goalMin: number;
  loadYesterday: number; // training load (TRIMP)
  loadAcute: number; // mean daily load, previous 7 days
  loadChronic: number; // mean daily load, previous 28 days
  bedOffMin: number | null; // last night's bedtime vs usual, minutes
};

export function energyScore(e: EnergyInput): Score {
  const s = energyParts(e);
  // A large rise in resting heart rate (often illness, alcohol or heavy fatigue) caps the score,
  // however good the other parts look.
  const rhrDelta = e.restingHr != null && e.restingHrUsual != null ? e.restingHr - e.restingHrUsual : null;
  const cap = rhrDelta == null ? 100 : interp(rhrDelta, [[4, 100], [5, 65], [8, 50], [12, 40]]);
  return s.score != null && s.score > cap ? { ...s, score: Math.round(cap), capped: true } : s;
}

function energyParts(e: EnergyInput): Score {
  const rhrDelta = e.restingHr != null && e.restingHrUsual != null ? e.restingHr - e.restingHrUsual : null;
  // Acute:chronic workload ratio. Up to ~1.3 is a normal training rhythm; well above means
  // recent load has jumped past what you're used to. The ratio is meaningless when the usual
  // load is tiny (two short runs would "double" a quiet month), so the chronic load has a floor
  // of 30 a day (about a 30-minute moderate session every other day), and a single session only
  // counts as hard once it is well above 40 (roughly an easy 30-minute run).
  const acwr = e.loadAcute / Math.max(e.loadChronic, 30);
  const ydayRatio = e.loadYesterday / Math.max(e.loadChronic, 40);
  const strain = Math.min(
    interp(acwr, [[0, 100], [1, 100], [1.3, 90], [1.5, 70], [2, 35], [3, 15]]),
    interp(ydayRatio, [[0, 100], [2, 95], [3, 75], [5, 40], [8, 20]]),
  );
  return combine([
    {
      key: "sleep", label: "Last night's sleep", weight: 30,
      score: e.sleepScore, detail: e.sleepScore == null ? "No sleep recorded" : `Sleep score ${e.sleepScore}`,
    },
    {
      key: "rhr", label: "Resting heart rate", weight: 25,
      score: rhrDelta == null ? null : interp(rhrDelta, [[-3, 100], [0, 92], [2, 78], [4, 55], [6, 35], [10, 10]]),
      detail: rhrDelta == null ? "Not enough data" : Math.abs(rhrDelta) < 1 ? `${Math.round(e.restingHr!)} bpm, same as usual`
        : `${Math.round(e.restingHr!)} bpm, ${Math.abs(rhrDelta).toFixed(1)} ${rhrDelta > 0 ? "above" : "below"} usual`,
    },
    {
      key: "balance", label: "Sleep balance", weight: 15,
      score: e.avgAsleep7 == null ? null : interp(e.avgAsleep7 / e.goalMin, [[0.6, 10], [0.75, 45], [0.85, 70], [0.95, 90], [1, 100]]),
      detail: e.avgAsleep7 == null ? "Not enough data" : `${hm(e.avgAsleep7)} a night over the last week`,
    },
    {
      key: "recovery", label: "Recovery from training", weight: 20,
      score: strain,
      detail: e.loadYesterday === 0 && e.loadAcute < 5 ? "No recent training strain"
        : ydayRatio >= 3 ? "Hard session yesterday"
        : acwr >= 1.5 ? "Training load well above your norm this week"
        : acwr >= 1.3 ? "Training load a little above your norm" : "Training load in line with your norm",
    },
    {
      key: "timing", label: "Bedtime consistency", weight: 10,
      score: e.bedOffMin == null ? null : interp(e.bedOffMin, TIMING),
      detail: e.bedOffMin == null ? "Not enough data" : e.bedOffMin < 15 ? "Went to bed at your usual time" : `Bedtime ${Math.round(e.bedOffMin)} min off your usual`,
    },
  ]);
}

export const ENERGY_ADVICE: Record<(typeof BANDS)[number]["label"], string> = {
  Excellent: "Well recovered. A good day for a hard workout.",
  Good: "Ready for a normal day.",
  Fair: "Some signs of fatigue. Consider an easier day.",
  Low: "Your body is under strain. Prioritise rest and sleep.",
};

// ---------------------------------------------------------------------------------------------

export type ActivityInput = {
  steps: number | null;
  stepGoal: number;
  exerciseMin: number;
  exerciseGoal: number;
  weekExerciseMin: number; // last 7 days including this one
};

export function activityScore(a: ActivityInput): Score {
  return combine([
    {
      key: "steps", label: "Steps", weight: 60,
      score: a.steps == null ? null : interp(a.steps / a.stepGoal, [[0, 0], [0.25, 20], [0.5, 50], [0.75, 75], [1, 100]]),
      detail: a.steps == null ? "No step data" : `${Math.round(a.steps).toLocaleString()} of ${a.stepGoal.toLocaleString()}`,
    },
    {
      key: "exercise", label: "Exercise today", weight: 10,
      score: interp(a.exerciseMin / a.exerciseGoal, [[0, 0], [0.5, 50], [1, 100]]),
      detail: `${Math.round(a.exerciseMin)} of ${a.exerciseGoal} min`,
    },
    {
      key: "week", label: "Weekly exercise", weight: 30,
      score: interp(a.weekExerciseMin / 150, [[0, 0], [0.5, 50], [1, 100]]),
      detail: `${Math.round(a.weekExerciseMin)} of 150 min over 7 days`,
    },
  ]);
}

export const SCORE_HELP = {
  sleep: "Combines how long you slept against your goal, how much of your time in bed you were asleep, your share of deep and REM sleep, and how close your bedtime was to your usual.",
  energy: "Estimates how recovered you are this morning from last night's sleep, your resting heart rate against your usual, your sleep over the past week, recent training load against your norm, and bedtime consistency. A resting heart rate 5+ bpm above your usual caps the score, since that often means illness or heavy fatigue.",
  activity: "Mostly today's steps against your goal, plus exercise over the last 7 days against the recommended 150 minutes a week, and a little for exercising today. Rest days with good steps still score well.",
} as const;
