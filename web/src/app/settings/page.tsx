import { Database, KeyRound, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Panel } from "@/components/dash/primitives";
import { PageBody, PageHeader } from "@/components/page-header";
import { agentBackend } from "@/lib/agent";
import { observedMaxHr, syncedHeightM } from "@/lib/analytics";
import { DB_PATH } from "@/lib/db";
import { fmtNum } from "@/lib/format";
import { SETTINGS, settingFallback, settingWithSource, type SettingKey } from "@/lib/settings";
import { SettingsForm, type Field } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

/** What an empty field falls back to, in words. */
function fallbackText(key: SettingKey): string {
  const v = settingFallback(key);
  const fromEnv = Number(process.env[SETTINGS[key].env]) > 0;
  if (v != null) return `${v.toLocaleString()}${fromEnv ? " (from .env.local)" : " (default)"}`;
  if (key === "maxHr") {
    const observed = observedMaxHr();
    return observed ? `${observed} (highest recorded)` : "190 (default)";
  }
  const h = syncedHeightM();
  return h ? `${fmtNum(h * 100, 1)} (synced)` : "Not set";
}

function field(key: SettingKey): Field {
  const { label, unit, help, min, max, step } = SETTINGS[key];
  const cur = settingWithSource(key);
  return { key, label, unit, help, min, max, step, value: cur.source === "saved" ? String(cur.value) : "", fallback: fallbackText(key) };
}

export default async function SettingsPage() {
  await connection();
  const backend = agentBackend();

  return (
    <>
      <PageHeader title="Settings" subtitle="Your goals and measurements. Changes apply everywhere right away." />
      <PageBody>
        <div className="mx-auto max-w-3xl space-y-4">
          <SettingsForm groups={[
            { title: "Goals", description: "Used for the rings on Today, goal lines on charts, and scores", fields: [field("stepsGoal"), field("sleepGoalHours"), field("exerciseGoalMin")] },
            { title: "About you", description: "Makes estimates like distance, BMI and heart-rate zones fit you", fields: [field("heightCm"), field("maxHr")] },
          ]} />

          <Panel title="Set in web/.env.local" description="These stay out of the dashboard because anyone on your network can open it. Restart the dashboard after changing them.">
            <dl className="divide-y text-sm">
              {[
                { icon: Sparkles, label: "Ask assistant", value: backend === "api" ? "Anthropic API (ANTHROPIC_API_KEY)" : "Claude Code on this computer", hint: "Set ANTHROPIC_API_KEY to use the API instead" },
                { icon: KeyRound, label: "Watch Sync token", value: process.env.INGEST_TOKEN ? "Set" : "Not set", hint: "INGEST_TOKEN; the phone app needs it to upload" },
                { icon: Database, label: "Database", value: DB_PATH, hint: "HEALTH_DB_PATH" },
              ].map((r) => (
                <div key={r.label} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <r.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <dt className="font-medium">{r.label}</dt>
                    <dd className="text-xs text-muted-foreground">{r.hint}</dd>
                  </div>
                  <dd className="min-w-0 break-all text-right text-xs">{r.value}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </PageBody>
    </>
  );
}
