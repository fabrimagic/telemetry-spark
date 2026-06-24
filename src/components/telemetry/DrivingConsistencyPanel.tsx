// Driving Consistency panel — shows per-zone spatial dispersion (Part 1) and,
// when enough valid laps are available, the temporal drift between the first
// and second half of the stint (Part 2), plus a compact stint summary.
//
// All numbers come from buildDrivingConsistency, which reuses the per-zone
// signature aggregated by buildBrakingSignature. No invented thresholds —
// only sample statistics (mean, std, CV) and per-half deltas. The engineer
// reads the data and decides; the engine does not diagnose.

import { useMemo } from "react";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow, AbsHit } from "@/lib/ld/stintAnalysis";
import {
  buildDrivingConsistency,
  type MetricDrift,
  type SpatialDispersionRow,
  type ZoneDrift,
} from "@/lib/ld/drivingConsistency";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmt(n: number | undefined | null, d = 1): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function fmtSigned(n: number, d = 1, unit = ""): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}${unit}`;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-muted-foreground">{children}</p>;
}

function lapListLabel(lapNums: number[]): string {
  if (lapNums.length === 0) return "—";
  if (lapNums.length <= 4) return lapNums.map((n) => `L${n}`).join(", ");
  return `L${lapNums[0]}–L${lapNums[lapNums.length - 1]} (${lapNums.length} giri)`;
}

/**
 * Heuristic worsening flag for vMin/brakePoint drift:
 *  - vMin: a NEGATIVE deltaMean (slower in second half) is the worsening sign.
 *  - brakePointDist: a NEGATIVE deltaMean (anticipating brake point) is the
 *    sign typically associated with tyre / brake degradation in long stints.
 *  - For any metric: an INCREASE in std is a dispersion worsening.
 * These are colour cues for readability, not diagnoses.
 */
function deltaClass(
  d: MetricDrift,
  kind: "vmin" | "brakePoint" | "neutral",
): string {
  if (!d.available || !Number.isFinite(d.deltaMean)) return "";
  if (kind === "vmin" && d.deltaMean < 0) return "text-race-red";
  if (kind === "brakePoint" && d.deltaMean < 0) return "text-race-red";
  return "";
}

function stdClass(d: MetricDrift): string {
  if (!d.available || !Number.isFinite(d.deltaStd)) return "";
  return d.deltaStd > 0 ? "text-race-red" : "";
}

export function DrivingConsistencyPanel({
  file,
  laps,
  absHits,
  hasAbs,
}: {
  file: LdFile;
  laps: LapRow[];
  absHits: AbsHit[];
  hasAbs: boolean;
}) {
  const result = useMemo(
    () => buildDrivingConsistency(file, laps, absHits, hasAbs),
    [file, laps, absHits, hasAbs],
  );

  if (result.kind !== "ok") {
    return <Notice>{result.message}</Notice>;
  }

  const spatial = result.spatial ?? [];
  if (spatial.length === 0) {
    return <Notice>Nessuna zona-curva disponibile per il calcolo.</Notice>;
  }

  // Sort spatial rows by combined CV (vMin + brakePoint), descending (least
  // consistent first), to make the unstable zones visually prominent.
  const spatialSorted: SpatialDispersionRow[] = [...spatial].sort((a, b) => {
    const sa = (Number.isFinite(a.vMinCV) ? a.vMinCV : 0) + (Number.isFinite(a.brakePointCV) ? a.brakePointCV : 0);
    const sb = (Number.isFinite(b.vMinCV) ? b.vMinCV : 0) + (Number.isFinite(b.brakePointCV) ? b.brakePointCV : 0);
    return sb - sa;
  });

  const drift = result.drift;
  const summary = result.summary;
  const showThrottle = result.hasThrottle;

  return (
    <div className="space-y-6">
      {/* Summary line */}
      {summary && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px]">
          <span className="uppercase tracking-widest text-muted-foreground">
            Riferimento · L{result.refLap?.lap} · lungh. giro {fmt(result.refLapLength, 0)} m ·
            {" "}{summary.lapsAnalysed} giri validi
          </span>
          {summary.leastConsistentZone && (
            <span className="uppercase tracking-widest text-muted-foreground">
              Zona meno consistente · <span className="text-ink">{summary.leastConsistentZone.label}</span>
            </span>
          )}
          {summary.biggestDriftZone && (
            <span className="uppercase tracking-widest text-muted-foreground">
              Deriva v<sub>min</sub> max · <span className="text-ink">{summary.biggestDriftZone.label}</span>
              {" "}({fmtSigned(summary.biggestDriftZone.deltaVmin, 1, " km/h")})
            </span>
          )}
        </div>
      )}

      {/* Part 1 — Spatial dispersion */}
      <div className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Parte 1 · Dispersione spaziale per zona (ordinata dalla meno alla più consistente)
        </h4>
        <div className="overflow-x-auto border border-ink/20">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-ink/30">
                <TableHead className="font-mono text-[10px] uppercase tracking-widest">Zona</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">n giri</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">σ v<sub>min</sub> (km/h)</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">σ punto fren. (m)</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">σ rilascio (m)</TableHead>
                {showThrottle && (
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">σ riapertura gas (m)</TableHead>
                )}
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">CV v<sub>min</sub></TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">CV punto fren.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spatialSorted.map((r, idx) => (
                <TableRow
                  key={r.zoneIndex}
                  className={`border-b border-ink/10 ${idx % 2 ? "bg-muted/40" : ""}`}
                >
                  <TableCell className="font-mono text-xs tabular-nums">
                    {r.label}
                    {idx === 0 && spatialSorted.length > 1 && (
                      <span className="ml-2 text-[9px] uppercase tracking-widest text-race-red">meno consistente</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{r.lapsAnalysed}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.vMinStd, 1)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.brakePointStd, 1)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.releaseLengthStd, 1)}</TableCell>
                  {showThrottle && (
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.throttleReopenStd, 1)}</TableCell>
                  )}
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.vMinCV, 3)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.brakePointCV, 3)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground">
          σ è la deviazione standard campionaria sui giri validi; CV = σ/|media|
          è un coefficiente di variazione adimensionale (non un punteggio
          arbitrario). Calcolato solo per v<sub>min</sub> e punto di frenata,
          dove ha senso fisico.
        </p>
      </div>

      {/* Part 2 — Temporal drift */}
      <div className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Parte 2 · Deriva temporale prima metà vs seconda metà
        </h4>
        {result.driftSkipped || !drift ? (
          <Notice>
            {result.driftSkippedReason ??
              "Deriva temporale non calcolabile con così pochi giri validi."}
          </Notice>
        ) : (
          <>
            {summary && (
              <p className="font-mono text-[10px] text-muted-foreground">
                Prima metà: {lapListLabel(summary.firstHalfLaps)} ·{" "}
                Seconda metà: {lapListLabel(summary.secondHalfLaps)} ·{" "}
                convenzione: con numero dispari il giro centrale va nella prima metà.
              </p>
            )}
            <div className="overflow-x-auto border border-ink/20">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-ink/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest">Zona</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">v<sub>min</sub> 1ª (km/h)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">v<sub>min</sub> 2ª (km/h)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δ v<sub>min</sub></TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δσ v<sub>min</sub></TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">punto fren. 1ª (m)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">punto fren. 2ª (m)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δ punto fren.</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δσ punto fren.</TableHead>
                    {showThrottle && (
                      <>
                        <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δ riapertura gas (m)</TableHead>
                        <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δ grad. gas (%/m)</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drift.map((d: ZoneDrift, idx) => (
                    <TableRow
                      key={d.zoneIndex}
                      className={`border-b border-ink/10 ${idx % 2 ? "bg-muted/40" : ""}`}
                    >
                      <TableCell className="font-mono text-xs tabular-nums">{d.label}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmt(d.vMin.first.mean, 1)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmt(d.vMin.second.mean, 1)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs tabular-nums font-bold ${deltaClass(d.vMin, "vmin")}`}>
                        {fmtSigned(d.vMin.deltaMean, 1)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs tabular-nums ${stdClass(d.vMin)}`}>
                        {fmtSigned(d.vMin.deltaStd, 1)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmt(d.brakePointDist.first.mean, 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmt(d.brakePointDist.second.mean, 0)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs tabular-nums font-bold ${deltaClass(d.brakePointDist, "brakePoint")}`}>
                        {fmtSigned(d.brakePointDist.deltaMean, 1)}
                      </TableCell>
                      <TableCell className={`text-right font-mono text-xs tabular-nums ${stdClass(d.brakePointDist)}`}>
                        {fmtSigned(d.brakePointDist.deltaStd, 1)}
                      </TableCell>
                      {showThrottle && (
                        <>
                          <TableCell className={`text-right font-mono text-xs tabular-nums ${stdClass(d.throttleReopenDist)}`}>
                            {fmtSigned(d.throttleReopenDist.deltaMean, 1)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {fmtSigned(d.throttleReopenGradient.deltaMean, 3)}
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              Δ = (seconda metà) − (prima metà). Sono evidenziati in rosso, per
              leggibilità, un calo di v<sub>min</sub>, un'anticipazione del
              punto di frenata e un aumento di dispersione: sono osservazioni
              dei dati, non diagnosi.
            </p>
          </>
        )}
      </div>

      <p className="max-w-4xl border-t border-ink/15 pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Tutte le grandezze derivano da canali misurati e dalle zone ancorate al
        giro di riferimento (L{result.refLap?.lap}). Gli indici di dispersione
        (σ, CV) sono statistiche campionarie; la deriva prima/seconda metà è
        un'osservazione dei dati e non una diagnosi. Il giudizio resta
        all'ingegnere.
      </p>
    </div>
  );
}
