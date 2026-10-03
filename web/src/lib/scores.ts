/**
 * Sleep, Energy, Strain and Activity scores.
 *
 * Every score is 0-100. Sleep, Energy and Activity are weighted averages of a few named parts,
 * each itself 0-100, so the UI can always show why a score is what it is. Strain is different:
 * it measures how much load the day put on your heart, so higher is not better. Personal parts are judged against your own
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

/** A score's verbal band; the tone colours it. */
export type Band = { label: string; tone: "good" | "warn" | "bad" | "neutral" };

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

export const SLEEP_ADVICE: Record<(typeof BANDS)[number]["label"], string> = {
  Excellent: "A full, restful night.",
  Good: "A solid night's sleep.",
  Fair: "Short or broken sleep. An earlier night would help.",
  Low: "Poor sleep. Go easy and make tonight a priority.",
};

// ---------------------------------------------------------------------------------------------

export type StrainInput = {
  hrLoad: number; // Banister load from every heart-rate reading of the day above resting effort
  workoutLoad: number; // the same, from workout average heart rate
  workoutCount: number;
  workoutMin: number;
  raisedMin: number; // minutes of the day with heart rate at or above 30% of reserve
};

/**
 * Load needed for a given strain, rising steeply at first and then flattening, the way each extra
 * hour of hard effort adds less: an easy 30-minute walk is about 20, a 45-minute run about 60,
 * and only very long or very hard days pass 90.
 */
const STRAIN_CURVE: [number, number][] = [[0, 0], [10, 10], [30, 25], [60, 40], [100, 55], [150, 67], [220, 80], [320, 90], [500, 98]];

export const strainFromLoad = (load: number) => interp(load, STRAIN_CURVE);

export const STRAIN_BANDS = [
  { min: 80, label: "All out", tone: "neutral" },
  { min: 55, label: "High", tone: "neutral" },
  { min: 30, label: "Moderate", tone: "neutral" },
  { min: 0, label: "Light", tone: "neutral" },
] as const;
export const strainBand = (score: number) => STRAIN_BANDS.find((b) => score >= b.min)!;

export function strainScore(s: StrainInput): Score {
  // Heart-rate readings cover workouts too, but a workout logged without readings still counts
  // through its average heart rate.
  const total = Math.max(s.hrLoad, s.workoutLoad);
  const other = Math.max(0, total - s.workoutLoad);
  return {
    score: Math.round(strainFromLoad(total)),
    parts: [
      {
        key: "workouts", label: "Workouts", weight: total ? Math.round((s.workoutLoad / total) * 100) : 0,
        score: Math.round(strainFromLoad(Math.min(s.workoutLoad, total))),
        detail: s.workoutCount ? `${s.workoutCount} workout${s.workoutCount > 1 ? "s" : ""}, ${hm(s.workoutMin)}` : "No workouts",
      },
      {
        key: "everyday", label: "Rest of the day", weight: total ? Math.round((other / total) * 100) : 0,
        score: Math.round(strainFromLoad(other)),
        detail: "Walking, stairs and other raised heart rate",
      },
      {
        key: "raised", label: "Raised heart rate", weight: 0,
        score: Math.round(interp(s.raisedMin, [[0, 0], [30, 30], [60, 55], [120, 80], [180, 95], [240, 100]])),
        detail: `${hm(s.raisedMin)} above 30% of your heart-rate reserve`,
      },
    ],
  };
}

/** A strain range that suits how recovered you are, from the morning's energy score. */
export function strainTarget(energy: number | null): [number, number] | null {
  if (energy == null) return null;
  return energy >= 85 ? [60, 85] : energy >= 70 ? [45, 70] : energy >= 55 ? [30, 50] : [10, 30];
}

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
  strain: "How much load the day put on your heart. Every heart-rate reading above about a third of your heart-rate reserve adds load, and harder efforts add far more per minute (Banister training load), so it covers workouts and everyday movement alike. The scale flattens near the top: light days sit under 30, a solid workout lands around 55 to 70, and only very long or very hard days pass 80. The target comes from your energy score: more recovered, more you can take on.",
  activity: "Mostly today's steps against your goal, plus exercise over the last 7 days against the recommended 150 minutes a week, and a little for exercising today. Rest days with good steps still score well.",
} as const;
