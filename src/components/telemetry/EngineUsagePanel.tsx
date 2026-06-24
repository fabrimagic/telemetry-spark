// Engine Usage panel — per-stint characterisation of RPM use.
//
// All thresholds are derived from the stint data itself (peak / quantile);
// no absolute engine red-line is assumed. Over-rev events are statistical
// peaks vs. the typical regime, NOT damage alarms. Shift counts are estimates
// from RPM-drop events because no reliable gear channel is available.

import { useMemo } from "react";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { buildEngineUsage } from "@/lib/ld/engineUsage";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Gauge } from "@/components/telemetry/Gauge";

function fmt(n: number | undefined, d = 0): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function fmtPct(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(d)}%`;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-muted-foreground">{children}</p>;
}

export function EngineUsagePanel({ file, laps }: { file: LdFile; laps: LapRow[] }) {
  const result = useMemo(() => buildEngineUsage(file, laps), [file, laps]);

  if (result.kind !== "ok") {
    return <Notice>{result.message}</Notice>;
  }

  const { perLap, overRevs, thresholds, summary } = result;
  const maxBar = Math.max(...perLap.map((r) => r.maxRpm ?? 0), thresholds.stintMaxRpm);

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 border border-ink/15 bg-muted/20 p-3 font-mono text-[11px] md:grid-cols-3 xl:grid-cols-6">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">RPM max stint</div>
          <div className="text-ink">{fmt(summary.stintMaxRpm, 0)} <span className="text-muted-foreground">@ L{summary.stintMaxLap}</span></div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            RPM medio {summary.hasThrottle ? "in trazione" : "(giro intero)"}
          </div>
          <div className="text-ink">{fmt(summary.meanRpmTractionAvg, 0)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            % tempo &gt; {fmt(thresholds.highRpmThreshold, 0)} rpm
          </div>
          <div className="text-ink">{fmtPct(summary.fracAboveHighAvg, 1)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Over-rev (eventi)</div>
          <div className={summary.totalOverRevs > 0 ? "text-race-red" : "text-ink"}>
            {summary.totalOverRevs}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Cambiate stimate</div>
          <div className="text-ink">{summary.totalShiftsEstimated}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Giri analizzati</div>
          <div className="text-ink">{summary.lapsAnalysed}</div>
        </div>
      </div>

      {/* Thresholds declaration */}
      <div className="border border-ink/15 bg-card p-3">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Soglie usate (derivate dai dati dello stint, non da limiti motore assoluti)
        </h4>
        <ul className="mt-2 list-disc pl-5 font-mono text-[11px] leading-relaxed text-ink">
          <li>
            Regime alto: <span className="tabular-nums">{fmt(thresholds.highRpmThreshold, 0)}</span> rpm
            {" "}= {(thresholds.highRpmFrac * 100).toFixed(0)}% di RPM max di stint ({fmt(thresholds.stintMaxRpm, 0)} rpm).
          </li>
          <li>
            Soglia over-rev: <span className="tabular-nums">{fmt(thresholds.overRevThreshold, 0)}</span> rpm
            {" "}= quantile {(thresholds.overRevQuantile * 100).toFixed(1)}% della distribuzione RPM nello stint.
          </li>
          <li>
            Drop minimo cambiata stimata: <span className="tabular-nums">{fmt(thresholds.shiftDropAbs, 0)}</span> rpm
            {" "}= {(thresholds.shiftDropFrac * 100).toFixed(0)}% di RPM max di stint, calo entro ≤ 1 s
            {summary.hasThrottle ? " e con throttle in trazione" : ""}.
          </li>
          {summary.hasThrottle && (
            <li>
              Trazione: campioni con throttle ≥ {(thresholds.throttleHighFrac * 100).toFixed(0)}% del picco throttle del giro.
            </li>
          )}
        </ul>
      </div>

      {/* Per-lap table */}
      <div className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Evoluzione per giro
        </h4>
        <div className="overflow-x-auto border border-ink/20">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-ink/30">
                <TableHead className="font-mono text-[10px] uppercase tracking-widest">Lap</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">RPM max</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest">RPM max (vis.)</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">
                  RPM medio {summary.hasThrottle ? "(traz.)" : "(giro)"}
                </TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">% &gt; alto</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Over-rev</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Cambiate stim.</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Drop medio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perLap.map((r, idx) => {
                const barPct = r.maxRpm !== undefined && maxBar > 0 ? (r.maxRpm / maxBar) * 100 : 0;
                return (
                  <TableRow
                    key={r.lap}
                    className={`border-b border-ink/10 ${idx % 2 ? "bg-muted/40" : ""} ${r.isFastest ? "border-l-2 border-l-race-red" : ""} ${r.overRevs > 0 ? "bg-race-red/5" : ""}`}
                  >
                    <TableCell className="font-mono text-xs tabular-nums">
                      L{r.lap}{r.isFastest && <span className="ml-1 text-[9px] uppercase tracking-widest text-race-red">fast</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.maxRpm, 0)}</TableCell>
                    <TableCell>
                      <div className="h-2 w-32 border border-ink/20 bg-card">
                        <div className="h-full bg-ink/60" style={{ width: `${barPct}%` }} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.meanRpmTraction, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmtPct(r.fracAboveHigh, 1)}</TableCell>
                    <TableCell className={`text-right font-mono text-xs tabular-nums ${r.overRevs > 0 ? "text-race-red font-bold" : ""}`}>
                      {r.overRevs}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{r.shiftsEstimated}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.shiftDropAvg, 0)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Over-rev events detail */}
      {overRevs.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Eventi over-rev (picchi statistici sopra la soglia derivata)
          </h4>
          <div className="overflow-x-auto border border-ink/20">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-ink/30">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Lap</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Peak RPM</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Sopra soglia (rpm)</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Durata (s)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overRevs.map((e, i) => (
                  <TableRow key={i} className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""}`}>
                    <TableCell className="font-mono text-xs tabular-nums">L{e.lap}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(e.peakRpm, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">+{fmt(e.excessRpm, 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{e.durationS.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="max-w-4xl border-t border-ink/15 pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        I valori RPM provengono dal canale già convertito dal parser; tutte le
        soglie qui sopra sono <span className="font-bold">derivate dai dati
        dello stint</span> e non da limiti assoluti del motore (non disponibili
        nel file). Gli <span className="font-bold">over-rev</span> sono picchi
        statistici rispetto al regime tipico, non allarmi di danno motore. Le{" "}
        <span className="font-bold">cambiate</span> sono stime da drop di RPM
        in assenza di canale marcia: eventi spuri (chiusure gas, downshift)
        possono essere inclusi. Il giudizio resta all'ingegnere.
        {!summary.hasThrottle && (
          <>
            {" "}Canale throttle assente: il regime medio è calcolato sull'intero
            giro, non solo in trazione.
          </>
        )}
      </p>
    </div>
  );
}
