import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  createSdkMcpServer, query, tool, SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DEFAULT_EFFORT, DEFAULT_MODEL, supportsEffort, type Effort, type ModelId } from "./models";
import { getReadonlyDb } from "./db";
import {
  dailyMetric, dailySampleStats, dataCoverage, exercises, listDays,
} from "./queries";
import { dailyScores, nights, restingHeartRate } from "./analytics";

const MAX_ROWS = 300;

const SCHEMA_DOC = `
Tables (SQLite). All *_ms columns are Unix epoch milliseconds (UTC). To bucket by the user's local day use
date(start_ms / 1000, 'unixepoch', 'localtime').

samples(uid, type, start_ms, end_ms, value, unit, source, meta JSON)
  Point measurements. Common types: heart_rate (bpm, ~1/min, denser in workouts),
  resting_heart_rate (from Google Fit, stops Jan 2026: do NOT use; get_daily_summary's resting_hr is the
  consistent value), hrv_rmssd (ms, not shared by Samsung Health, so normally absent), spo2 (%), weight (kg), body_fat (%), skeletal_muscle_mass (kg), respiratory_rate,
  skin_temperature, stress, blood_pressure_systolic, blood_pressure_diastolic, vo2_max.
daily_metrics(day 'YYYY-MM-DD' local, metric, value, source)
  Per-day totals, already de-duplicated across phone + watch: steps, distance_m, active_kcal, total_kcal, basal_kcal, floors, active_min.
  active_kcal rows with source 'estimated' are total_kcal minus basal_kcal (Samsung rarely shares active calories).
sleep_sessions(uid, start_ms, end_ms, score, source, meta JSON)
  One night is often SEVERAL sessions (the watch splits the night when you wake briefly). For per-night
  sleep figures use get_daily_summary, which merges them; if you write SQL, group sessions by
  date((end_ms + 6*3600000) / 1000, 'unixepoch', 'localtime') and sum, never take a single session as the night.
sleep_stages(session_uid -> sleep_sessions.uid, stage: awake|light|deep|rem|sleeping|out_of_bed, start_ms, end_ms)
exercise_sessions(uid, type, title, start_ms, end_ms, kcal, distance_m, avg_hr, max_hr, source, meta JSON)
`.trim();

const SYSTEM = `You are a personal health analyst for one person. Their Samsung Galaxy Watch 7 data (synced via
Samsung Health / Health Connect) is stored in a local database you can query with the tools provided.

${SCHEMA_DOC}

How to work:
- Ground every claim in the data. Query before answering; quote concrete numbers, dates and ranges.
- Start with get_data_coverage if you are unsure what data exists, and get_daily_summary for overviews.
  Use query_sql for anything more specific (correlations, comparisons, time-of-day patterns).
- When you compare periods or look for relationships, say how many days the comparison rests on, and treat
  correlation as correlation. Small samples and missing days are common: mention them when they matter.
- Give practical, personalised suggestions tied to what the data shows. You are not a doctor; if something
  looks medically concerning (e.g. persistently low SpO2, unusual resting HR changes), say so plainly and suggest
  checking with a clinician, without alarmism.
- The dashboard shows three 0-100 scores (85+ excellent, 70-84 good, 55-69 fair, <55 low), all in get_daily_summary:
  sleep_score (duration 35%, efficiency 15%, deep 15%, REM 15%, bedtime regularity 20%),
  energy_score, a morning readiness estimate (last night's sleep 30%, resting HR vs 30-day usual 25%, 7-night sleep
  balance 15%, recovery from training load 20%, bedtime consistency 10%; energy_parts lists each part's sub-score),
  activity_score (steps 60%, 7-day exercise vs 150 min 30%, exercise today 10%). A resting HR 5+ bpm above usual caps
  the energy score. Note many "workouts" are Samsung's auto-detected walks (type walking / other_0, ~10-20 min). Use energy_parts to explain why a
  score is high or low. There is no HRV: Samsung Health doesn't share it.
- Be concise. Lead with the answer, then the supporting numbers. Use short markdown tables for multi-day data.`;

function localDate(d = new Date()) {
  return d.toLocaleDateString("sv"); // YYYY-MM-DD in local time
}

const round = (n: number | null | undefined, d = 0) => (n == null ? null : Number(n.toFixed(d)));

/** Tool definitions shared by both backends (API tool runner and Claude Code). */
type ToolDef<S extends z.ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: S;
  run: (input: z.infer<z.ZodObject<S>>) => Promise<string>;
};
const defineTool = <S extends z.ZodRawShape>(def: ToolDef<S>) => def;

const toolDefs = [
  defineTool({
    name: "get_data_coverage",
    description:
      "Lists which kinds of data exist, how many records, and the date range covered. Call this first when unsure what is available.",
    inputSchema: {},
    run: async () => {
      const cov = dataCoverage();
      const types = getReadonlyDb()
        .prepare(
          `SELECT type, unit, COUNT(*) AS n,
                  date(MIN(start_ms)/1000,'unixepoch','localtime') AS first_day,
                  date(MAX(start_ms)/1000,'unixepoch','localtime') AS last_day
           FROM samples GROUP BY type, unit ORDER BY type`,
        )
        .all();
      const daily = getReadonlyDb()
        .prepare(`SELECT metric, COUNT(*) AS days, MIN(day) AS first_day, MAX(day) AS last_day FROM daily_metrics GROUP BY metric`)
        .all();
      return JSON.stringify({ sample_types: types, daily_metrics: daily, sleep_sessions: cov.sleep, exercise_sessions: cov.exercise, last_phone_sync: cov.lastAndroidSync ?? null });
    },
  }),

  defineTool({
    name: "get_daily_summary",
    description:
      "One row per local day with steps, sleep (total asleep minutes, deep/REM/light/awake minutes, score), resting heart rate, " +
      "average HRV, average SpO2, weight, and workouts. Best for overviews and day-to-day comparisons. Max 120 days per call.",
    inputSchema: {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date, inclusive, YYYY-MM-DD"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End date, inclusive, YYYY-MM-DD"),
    },
    run: async ({ from, to }) => {
      const days = listDays({ from, to });
      if (days.length > 120) return "Range too large: request at most 120 days per call.";
      const r = { from, to };
      const index = <T extends { day: string }>(rows: T[]) => new Map(rows.map((x) => [x.day, x]));
      const steps = index(dailyMetric("steps", r));
      const rhr = index(restingHeartRate(r));
      const hrv = index(dailySampleStats("hrv_rmssd", r));
      const spo2 = index(dailySampleStats("spo2", r));
      const weight = index(dailySampleStats("weight", r));
      const sleep = new Map(nights(r).map((n) => [n.day, n]));
      const scores = dailyScores(r);
      const workouts = new Map<string, string[]>();
      for (const w of exercises(r)) {
        const day = localDate(new Date(w.start_ms));
        const desc = `${w.type} ${Math.round((w.end_ms - w.start_ms) / 60000)}min${w.avg_hr ? ` avgHR ${Math.round(w.avg_hr)}` : ""}`;
        workouts.set(day, [...(workouts.get(day) ?? []), desc]);
      }
      const rows = days.map((day) => {
        const n = sleep.get(day);
        return {
          day,
          weekday: new Date(`${day}T12:00:00`).toLocaleDateString("en", { weekday: "short" }),
          steps: steps.get(day)?.value ?? null,
          sleep_asleep_min: n ? Math.round(n.asleep) : null,
          sleep_in_bed_min: n ? Math.round(n.total_min) : null,
          sleep_deep_min: n ? Math.round(n.deep) : null,
          sleep_rem_min: n ? Math.round(n.rem) : null,
          sleep_light_min: n ? Math.round(n.light) : null,
          sleep_awake_min: n ? Math.round(n.awake) : null,
          sleep_sessions: n ? n.uids.length : null,
          sleep_score: n?.score ?? null,
          energy_score: scores.get(day)?.energy.score ?? null,
          energy_parts: scores.get(day)?.energy.parts.map((p) => `${p.label} ${p.score ?? "n/a"}`).join(", ") ?? null,
          activity_score: scores.get(day)?.activity.score ?? null,
          bedtime: n ? new Date(n.start_ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null,
          wake_time: n ? new Date(n.end_ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null,
          resting_hr: round(rhr.get(day)?.value),
          hrv_ms: round(hrv.get(day)?.avg),
          spo2: round(spo2.get(day)?.avg, 1),
          weight_kg: round(weight.get(day)?.avg, 1),
          workouts: workouts.get(day)?.join("; ") ?? null,
        };
      });
      return JSON.stringify({ resting_hr_definition: "lowest 30-minute average heart rate while asleep, from the night ending that morning", rows });
    },
  }),

  defineTool({
    name: "query_sql",
    description:
      `Run one read-only SQLite SELECT (or WITH ... SELECT) against the health database and get rows back as JSON. ` +
      `Results are capped at ${MAX_ROWS} rows, so aggregate in SQL rather than pulling raw heart-rate samples.`,
    inputSchema: {
      sql: z.string().describe("A single SELECT statement"),
    },
    run: async ({ sql }) => {
      const trimmed = sql.trim().replace(/;\s*$/, "");
      if (!/^(select|with)\b/i.test(trimmed) || trimmed.includes(";")) {
        return "Error: only a single SELECT / WITH statement is allowed.";
      }
      try {
        // The connection is opened read-only, so even a crafted statement cannot modify data.
        const rows = getReadonlyDb().prepare(trimmed).all();
        const capped = rows.slice(0, MAX_ROWS);
        return JSON.stringify({
          row_count: rows.length,
          truncated: rows.length > MAX_ROWS,
          rows: capped,
        });
      } catch (e) {
        return `SQL error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  }),
];

export const agentTools = toolDefs.map((t) =>
  betaZodTool({ name: t.name, description: t.description, inputSchema: z.object(t.inputSchema), run: t.run as (i: unknown) => Promise<string> }),
);

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "error"; message: string };

class TruncatedToolInput extends Error {}

function todayLine() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Today is ${localDate()} (${new Date().toLocaleDateString("en", { weekday: "long" })}), timezone ${tz}.`;
}

/** Which backend answers: the Anthropic API when a key is configured, otherwise the local Claude Code login. */
export function agentBackend(): "api" | "claude-code" {
  const forced = process.env.AGENT_BACKEND;
  if (forced === "api" || forced === "claude-code") return forced;
  return process.env.ANTHROPIC_API_KEY ? "api" : "claude-code";
}

/**
 * Runs the agent over the conversation and yields text deltas and tool activity as they happen.
 * History is sent as plain text turns; the agent re-queries data each turn rather than relying on old tool results.
 */
export type AgentOptions = { model?: ModelId; effort?: Effort };

export function runAgent(history: ChatTurn[], opts: AgentOptions = {}): AsyncGenerator<AgentEvent> {
  const model = opts.model ?? DEFAULT_MODEL;
  // Haiku has no effort control; sending one is an error.
  const effort = supportsEffort(model) ? (opts.effort ?? DEFAULT_EFFORT) : undefined;
  return agentBackend() === "api" ? runApiAgent(history, model, effort) : runClaudeCodeAgent(history, model, effort);
}

async function* runApiAgent(history: ChatTurn[], model: ModelId, effort?: Effort): AsyncGenerator<AgentEvent> {
  const client = new Anthropic();

  let runner = client.beta.messages.toolRunner({
    model,
    max_tokens: 64000,
    ...(effort && {
      output_config: { effort },
      // On a safety-classifier decline, the API re-runs the request on an appropriate fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default" as const,
    }),
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: todayLine() },
    ],
    tools: agentTools.map((t) => ({ ...t, eager_input_streaming: true })),
    messages: history.map((t) => ({ role: t.role, content: t.content })),
    max_iterations: 15,
    stream: true,
  });

  for (let attempt = 0; ; attempt++) {
    try {
      for await (const messageStream of runner) {
        for await (const event of messageStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          }
        }
        const message = await messageStream.finalMessage();
        attempt = 0;

        const toolUses = message.content.filter((b) => b.type === "tool_use");
        if (message.stop_reason === "max_tokens" && toolUses.length) {
          throw new TruncatedToolInput("tool input truncated");
        }
        if (message.stop_reason === "refusal") {
          yield { type: "error", message: "The model declined to answer this request." };
          return;
        }
        for (const t of toolUses) yield { type: "tool", name: t.name, input: t.input };
        // Separate the text of consecutive turns (before/after tool calls).
        if (toolUses.length) yield { type: "text", text: "\n\n" };
      }
      return;
    } catch (err) {
      if (err instanceof Anthropic.APIError || err instanceof TruncatedToolInput || attempt >= 2) throw err;
      runner = client.beta.messages.toolRunner({ ...runner.params });
    }
  }
}

const MCP_SERVER = "health";
const MCP_PREFIX = `mcp__${MCP_SERVER}__`;

const healthServer = createSdkMcpServer({
  name: MCP_SERVER,
  alwaysLoad: true,
  tools: toolDefs.map((t) =>
    tool(t.name, t.description, t.inputSchema, async (input) => ({
      content: [{ type: "text" as const, text: await t.run(input as never) }],
    }), { annotations: { readOnlyHint: true } }),
  ),
});

/** Claude Code takes a single prompt per query, so earlier turns are folded into it as a transcript. */
function promptFromHistory(history: ChatTurn[]) {
  const last = history.at(-1)!.content;
  if (history.length === 1) return last;
  const earlier = history
    .slice(0, -1)
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`)
    .join("\n\n");
  return `<conversation_so_far>\n${earlier}\n</conversation_so_far>\n\n${last}`;
}

/**
 * Same agent, run through the locally installed Claude Code (its claude.ai login pays for it).
 * Built-in tools, user settings, plugins and other MCP servers are all switched off: the model
 * only sees the three read-only health tools.
 */
async function* runClaudeCodeAgent(history: ChatTurn[], model: ModelId, effort?: Effort): AsyncGenerator<AgentEvent> {
  const abortController = new AbortController();
  // Without a key in its environment, Claude Code uses its own login rather than the API.
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const run = query({
    prompt: promptFromHistory(history),
    options: {
      model,
      effort,
      systemPrompt: [SYSTEM, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, todayLine()],
      tools: [],
      mcpServers: { [MCP_SERVER]: healthServer },
      strictMcpConfig: true,
      allowedTools: toolDefs.map((t) => MCP_PREFIX + t.name),
      permissionMode: "dontAsk",
      settingSources: [],
      persistSession: false,
      includePartialMessages: true,
      maxTurns: 15,
      abortController,
      env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: "gw-dashboard" },
    },
  });

  try {
    for await (const msg of run) {
      if (msg.type === "stream_event" && msg.parent_tool_use_id === null) {
        const ev = msg.event;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          yield { type: "text", text: ev.delta.text };
        }
      } else if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
        const toolUses = msg.message.content.filter((b) => b.type === "tool_use");
        for (const t of toolUses) yield { type: "tool", name: t.name.replace(MCP_PREFIX, ""), input: t.input };
        if (toolUses.length) yield { type: "text", text: "\n\n" };
      } else if (msg.type === "auth_status" && msg.error) {
        yield { type: "error", message: `Claude Code is not logged in (${msg.error}). Run \`claude\` and /login, then retry.` };
        return;
      } else if (msg.type === "result") {
        if (msg.subtype !== "success") {
          yield { type: "error", message: msg.subtype === "error_max_turns" ? "Stopped after too many data lookups." : `Claude Code error: ${msg.subtype}` };
        } else if (msg.is_error) {
          yield { type: "error", message: msg.result || "Claude Code returned an error." };
        } else if (msg.stop_reason === "refusal") {
          yield { type: "error", message: "The model declined to answer this request." };
        }
        return;
      }
    }
  } finally {
    abortController.abort();
  }
}
