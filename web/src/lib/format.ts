export const fmtDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export const fmtNum = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtMinutes = (min: number) => {
  const m = Math.round(min); // round first, so 59.6 min shows as "1h 00m", not "0h 60m"
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

export const fmtClock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Minutes after 18:00 (as used for bed/wake times) → "22:45". */
export const fmtTimeOfNight = (minAfter6pm: number) => {
  const m = Math.round(minAfter6pm + 18 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export type Period = "day" | "week" | "month";

export const fmtPeriod = (day: string, period: Period) => {
  const d = new Date(`${day}T12:00:00`);
  if (period === "month") return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  if (period === "week") return `Week of ${fmtDay(day)}`;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

export const fmtPace = (durationMs: number, meters: number) => {
  const secPerKm = durationMs / 1000 / (meters / 1000);
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, "0")} /km`;
};

export const fmtLongDay = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const titleCase = (s: string) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());

/** "just now", "12 min ago", "3 h ago", "yesterday", "2 Oct". */
export const fmtAgo = (ms: number, now: number) => {
  const min = Math.round((now - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  if (min < 48 * 60) return "yesterday";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
