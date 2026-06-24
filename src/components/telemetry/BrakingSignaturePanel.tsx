// Braking & Traction Signature panel — per-corner aggregated stats across all
// valid laps of the stint. Zones are defined on the fastest valid lap and
// projected to every other valid lap by distance.
//
// Disclaimers surfaced in the UI:
//  - Zones are anchored on the reference lap and projected by distance.
//  - All quantities are measured from channels; threshold fractions derive
//    from each lap's OWN peaks (no invented absolute values).
//  - ABS activity is counted only on valid laps.

import { useMemo } from "react";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow, AbsHit } from "@/lib/ld/stintAnalysis";
import {
  buildBrakingSignature,
  highDispersionZones,
  type SignatureRow,
  type ZoneStat,
} from "@/lib/ld/brakingSignature";
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
function fmtStat(s: ZoneStat | undefined, d = 1, unit = ""): string {
  if (!s || !Number.isFinite(s.mean)) return "—";
  const base = `${s.mean.toFixed(d)}${unit}`;
  if (Number.isFinite(s.std) && s.n >= 2) {
    return `${base} ± ${s.std.toFixed(d)}`;
  }
  return base;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-muted-foreground">{children}</p>;
}

export function BrakingSignaturePanel({
  file,
  laps,
  absHits,
  hasAbs,
}: {
  file: LdFile;
  laps: LapRow[];
  absHits: AbsHit[];
  /** From StintAnalysis.has.abs */
  hasAbs: boolean;
}) {
  const result = useMemo(
    () => buildBrakingSignature(file, laps, absHits, hasAbs),
    [file, laps, absHits, hasAbs],
  );

  if (result.kind !== "ok") {
    return <Notice>{result.message}</Notice>;
  }

  const rows = result.rows ?? [];
  if (rows.length === 0) {
    return <Notice>Nessuna zona-curva rilevata sul giro di riferimento.</Notice>;
  }

  const brakePointDispersed = highDispersionZones(rows, (r) => r.brakePointDist.std);
  const vMinDispersed = highDispersionZones(rows, (r) => r.vMin.std);
  const showThrottle = result.hasThrottle;
  const showAbs = result.hasAbs;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px]">
        <span className="uppercase tracking-widest text-muted-foreground">
          Riferimento · L{result.refLap?.lap} · lungh. giro {fmt(result.refLapLength, 0)} m ·
          {" "}{result.lapsConsidered} giri validi
        </span>
      </div>

      <div className="overflow-x-auto border border-ink/20">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-ink/30">
              <TableHead className="font-mono text-[10px] uppercase tracking-widest">Zona</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">d start (m)</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">v min (km/h)</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">brake peak (bar)</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">brake point (m)</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">rilascio (m)</TableHead>
              {showThrottle && (
                <>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">riapertura gas (m)</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">grad. gas (%/m)</TableHead>
                </>
              )}
              {showAbs && (
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">ABS (tot · giri · dur)</TableHead>
              )}
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">n giri</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r: SignatureRow, idx) => {
              const flagBrake = brakePointDispersed.has(idx);
              const flagVmin = vMinDispersed.has(idx);
              return (
                <TableRow
                  key={r.zone.index}
                  className={`border-b border-ink/10 ${idx % 2 ? "bg-muted/40" : ""}`}
                >
                  <TableCell className="font-mono text-xs tabular-nums">
                    {r.label}
                    {r.zone.fromSpeed && (
                      <span className="ml-1 text-[9px] uppercase tracking-widest text-muted-foreground">·v</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.zone.startDist, 0)}</TableCell>
                  <TableCell className={`text-right font-mono text-xs tabular-nums ${flagVmin ? "text-race-red font-bold" : ""}`}>
                    {fmtStat(r.vMin, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmtStat(r.brakePeak, 1)}</TableCell>
                  <TableCell className={`text-right font-mono text-xs tabular-nums ${flagBrake ? "text-race-red font-bold" : ""}`}>
                    {fmtStat(r.brakePointDist, 0)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmtStat(r.releaseLength, 0)}</TableCell>
                  {showThrottle && (
                    <>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{fmtStat(r.throttleReopenDist, 0)}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{fmtStat(r.throttleReopenGradient, 2)}</TableCell>
                    </>
                  )}
                  {showAbs && (
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {r.abs.available
                        ? `${r.abs.totalHits} · ${r.abs.lapsWithAbs}L · ${
                            Number.isFinite(r.abs.meanDurationS)
                              ? r.abs.meanDurationS.toFixed(2) + "s"
                              : "—"
                          }`
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right font-mono text-xs tabular-nums">{r.lapsAnalysed}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="max-w-4xl border-t border-ink/15 pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        Zone ancorate al giro di riferimento (L{result.refLap?.lap}) e proiettate
        per distanza sugli altri giri. Tutte le grandezze sono misurate dai
        canali; le frazioni-soglia (punto frenata = 18% del picco del giro,
        riapertura gas = 50% del picco di throttle) derivano dai picchi di
        ciascun giro — nessun valore assoluto inventato. L'attività ABS è
        conteggiata sui soli giri validi. Zone con dispersione anomala su punto
        frenata o vMin sono evidenziate in rosso; il giudizio resta
        all'ingegnere.
        {rows.some((r) => r.zone.fromSpeed) && (
          <>
            {" "}Le zone marcate <span className="font-bold">·v</span> sono
            derivate dai minimi di velocità (canali freni assenti sul
            riferimento).
          </>
        )}
      </p>
    </div>
  );
}
