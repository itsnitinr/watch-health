"use client";

import { Check } from "lucide-react";
import { useActionState, useState } from "react";
import { Panel } from "@/components/dash/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { haptic } from "@/lib/haptics";
import type { SettingKey } from "@/lib/settings";
import { save, type SaveState } from "./actions";

export type Field = {
  key: SettingKey; label: string; unit: string; help: string; min: number; max: number; step: number;
  /** The saved value, or "" when unset. */
  value: string;
  /** What applies when the field is empty, e.g. "10,000 (default)". */
  fallback: string;
};

export function SettingsForm({ groups }: { groups: { title: string; description: string; fields: Field[] }[] }) {
  const [values, setValues] = useState(() => Object.fromEntries(groups.flatMap((g) => g.fields).map((f) => [f.key, f.value])));
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useActionState<SaveState, FormData>(async (prev, formData) => {
    const next = await save(prev, formData);
    if (next.savedAt) { setDirty(false); haptic("done"); }
    return next;
  }, {});

  return (
    <form action={action} className="space-y-4">
      {groups.map((g) => (
        <Panel key={g.title} title={g.title} description={g.description}>
          <div className="divide-y">
            {g.fields.map((f) => {
              const error = state.errors?.[f.key];
              return (
                <div key={f.key} className="grid gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[1fr_16rem] sm:items-center">
                  <div className="min-w-0">
                    <label htmlFor={f.key} className="text-sm font-medium">{f.label}</label>
                    <p className="text-xs text-muted-foreground">{f.help}</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <Input id={f.key} name={f.key} type="number" inputMode="decimal" min={f.min} max={f.max} step={f.step}
                        value={values[f.key]} placeholder={f.fallback} aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${f.key}-error` : undefined}
                        onChange={(e) => { setValues((v) => ({ ...v, [f.key]: e.target.value })); setDirty(true); }} />
                      <span className="w-12 shrink-0 text-xs text-muted-foreground">{f.unit}</span>
                    </div>
                    {error && <p id={`${f.key}-error`} className="mt-1 text-xs text-destructive">{error}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
      <div className="flex items-center justify-end gap-3">
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {state.errors ? "Fix the highlighted fields" : state.savedAt && !dirty
            ? <span className="inline-flex items-center gap-1"><Check className="size-3.5 text-good" /> Saved</span>
            : "Leave a field empty to use the value shown in it"}
        </p>
        <Button type="submit" disabled={pending || !dirty}>{pending ? "Saving…" : "Save"}</Button>
      </div>
    </form>
  );
}
