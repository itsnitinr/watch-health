// Colour constants shared by server and client components (kept out of "use client"
// modules so server components get the real values, not client references).

export const STAGES = [
  { key: "deep", label: "Deep", color: "var(--stage-deep)" },
  { key: "rem", label: "REM", color: "var(--stage-rem)" },
  { key: "light", label: "Light", color: "var(--stage-light)" },
  { key: "awake", label: "Awake", color: "var(--stage-awake)" },
] as const;

export const ZONE_COLORS = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)"];
