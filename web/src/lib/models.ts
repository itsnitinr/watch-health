/** Models and effort levels the Ask page offers. Shared by the chat UI, the API route and the agent. */

export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", hint: "Best balance for analysis", effort: true },
  { id: "claude-fable-5-1", label: "Fable 5.1", hint: "Most capable; may use extra usage credits", effort: true },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", hint: "Faster, lighter on usage", effort: true },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", hint: "Fastest, for quick lookups", effort: false },
] as const;

export const EFFORTS = [
  { id: "low", label: "Low", hint: "Quick answers" },
  { id: "medium", label: "Medium", hint: "Default" },
  { id: "high", label: "High", hint: "More thorough" },
  { id: "xhigh", label: "Extra high", hint: "Deep analysis" },
  { id: "max", label: "Max", hint: "Slowest, most thorough" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];
export type Effort = (typeof EFFORTS)[number]["id"];

export const DEFAULT_MODEL: ModelId = "claude-opus-5-5";
export const DEFAULT_EFFORT: Effort = "medium";

export const isModelId = (v: unknown): v is ModelId => MODELS.some((m) => m.id === v);
export const isEffort = (v: unknown): v is Effort => EFFORTS.some((e) => e.id === v);
export const supportsEffort = (model: ModelId) => MODELS.find((m) => m.id === model)!.effort;
