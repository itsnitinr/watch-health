"use server";

import { revalidatePath } from "next/cache";
import { SETTINGS, SETTING_KEYS, saveSettings, type SettingKey } from "@/lib/settings";

export type SaveState = { errors?: Partial<Record<SettingKey, string>>; savedAt?: number };

// No auth check: the dashboard has no login, and anyone who can open it can already see all of it.
export async function save(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const values: Partial<Record<SettingKey, number | null>> = {};
  const errors: SaveState["errors"] = {};
  for (const key of SETTING_KEYS) {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") { values[key] = null; continue; }
    const n = Number(raw);
    const { min, max, unit } = SETTINGS[key];
    if (!Number.isFinite(n) || n < min || n > max) errors[key] = `Enter ${min}–${max} ${unit}`;
    else values[key] = n;
  }
  if (Object.keys(errors).length) return { errors };
  saveSettings(values);
  revalidatePath("/", "layout");
  return { savedAt: Date.now() };
}
