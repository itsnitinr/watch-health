import { Footprints, Timer } from "lucide-react";
import { PaceChart } from "@/components/dash/charts";
import { KV, Panel } from "@/components/dash/primitives";
import { fmtMinutes, fmtPaceSec } from "@/lib/format";
import type { RunDetail } from "@/lib/run";
import { cn } from "@/lib/utils";

/** Pace chart, run stats and per-km splits for a workout with detailed speed readings. */
export function RunPanels({ run }: { run: RunDetail }) {
  const { splits, bestSplit, worstSplit, halves } = run;
  const full = splits.filter((s) => s.meters >= 999);
  const fastest = Math.min(...full.map((s) => s.pace), ...splits.map((s) => s.pace));
  const slowest = Math.max(...splits.map((s) => s.pace));
  // Bars show speed: the fastest km is full width, the slowest half width
  const width = (pace: number) => 100 - ((pace - fastest) / (slowest - fastest || 1)) * 50;
  const halfDiff = halves ? halves.second - halves.first : 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
      <Panel title="Pace" icon={Timer} domain="exercise" description="Smoothed over 30 seconds, with heart rate. Faster is higher.">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KV label="Average pace" value={`${fmtPaceSec(run.avgPace)} /km`} sub={`moving ${fmtMinutes(run.movingSeconds / 60)}`} />
            <KV label="Fastest km" value={bestSplit ? `${fmtPaceSec(bestSplit.pace)} /km` : "-"} sub={bestSplit ? `km ${bestSplit.km}` : undefined} />
            <KV label="Best 30 seconds" value={run.bestRolling ? `${fmtPaceSec(run.bestRolling.pace)} /km` : "-"}
              sub={run.bestRolling ? `at ${run.bestRolling.at.toFixed(1)} km` : undefined} />
            <KV label="Second half" value={halves ? `${fmtPaceSec(halves.second)} /km` : "-"}
              sub={halves ? (Math.abs(halfDiff) < 3 ? "even with the first half"
                : `${Math.round(Math.abs(halfDiff))} s/km ${halfDiff < 0 ? "faster" : "slower"} than the first`) : undefined} />
          </div>
          <PaceChart data={run.series} height={260} />
        </div>
      </Panel>

      <Panel title="Splits" icon={Footprints} domain="exercise"
        description={bestSplit && worstSplit && bestSplit !== worstSplit
          ? `${Math.round(worstSplit.pace - bestSplit.pace)} s/km between your fastest and slowest km`
          : "Time for each kilometre"}>
        <table className="tabular w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="pb-2 text-left font-normal">Km</th>
              <th className="pb-2 text-left font-normal">Pace</th>
              <th className="pb-2 font-normal" />
              <th className="pb-2 text-right font-normal">HR</th>
            </tr>
          </thead>
          <tbody>
            {splits.map((s) => {
              const partial = s.meters < 999;
              return (
                <tr key={s.km} className="border-t">
                  <td className="py-2 pr-3 text-muted-foreground">{partial ? (s.km - 1 + s.meters / 1000).toFixed(2) : s.km}</td>
                  <td className={cn("py-2 pr-3 font-semibold", s === bestSplit && "text-exercise")}>
                    {fmtPaceSec(s.pace)}
                    {/* m:ss of the leftover distance, using the same formatter as pace */}
                    {partial && <span className="ml-1 text-xs font-normal text-muted-foreground">in {fmtPaceSec(s.seconds)}</span>}
                  </td>
                  <td className="w-full py-2">
                    <div className="h-2 rounded-full" style={{
                      width: `${width(s.pace)}%`,
                      background: s === bestSplit ? "var(--exercise)" : "color-mix(in oklab, var(--exercise) 45%, transparent)",
                    }} />
                  </td>
                  <td className="py-2 pl-3 text-right">{s.avgHr != null ? Math.round(s.avgHr) : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
