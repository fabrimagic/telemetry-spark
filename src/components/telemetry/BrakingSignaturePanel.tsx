// Braking & Traction Signature panel — per-corner aggregated stats across all
// valid laps of the stint. Zones are defined on the fastest valid lap and
// projected to every other valid lap by distance.
//
// Heatmap notes:
//  - The matrix shows ONLY measured per-(lap, zone) values exposed by the
//    engine (perLapValues). Cells with no valid sample are rendered neutral —
//    no interpolation, no inferred values.
//  - Color is normalised PER ZONE (per column): each corner has its own
//    natural speed/brake-point range, so the colour means "in THIS corner,
//    this lap was faster/slower/later/earlier than the typical lap". This
//    choice is declared in the panel.
//
// Disclaimers surfaced in the UI:
//  - Zones are anchored on the reference lap and projected by distance.
//  - All quantities are measured from channels; threshold fractions derive
//    from each lap's OWN peaks (no invented absolute values).
//  - ABS activity is counted only on valid laps.

import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";

type HeatMetric = "vMin" | "brakePointDist";

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

interface ColumnStats {
  min: number;
  max: number;
  n: number;
}

function columnStats(values: Array<number | undefined>): ColumnStats {
  let min = Infinity;
  let max = -Infinity;
  let n = 0;
  for (const v of values) {
    if (v === undefined || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    n++;
  }
  if (n === 0) return { min: NaN, max: NaN, n: 0 };
  return { min, max, n };
}

/** Cool→warm divergent ramp. t in [0,1]. */
function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  // Hue 220 (cool blue) → 10 (warm red); fixed S/L for readability on paper bg.
  const hue = 220 - clamped * 210;
  return `hsl(${hue.toFixed(0)}, 70%, 55%)`;
}

const NEUTRAL_BG = "hsl(var(--ink) / 0.06)";

interface CellInfo {
  lap: number;
  label: string;
  value: number | undefined;
  metric: HeatMetric;
  unit: string;
  norm?: number; // 0..1 in column
}

function Heatmap({
  rows,
  validLapNumbers,
  metric,
}: {
  rows: SignatureRow[];
  validLapNumbers: number[];
  metric: HeatMetric;
}) {
  const unit = metric === "vMin" ? "km/h" : "m";

  // Build matrix: [lapIndex][zoneIndex] → number | undefined
  const cols: Array<{ row: SignatureRow; values: Array<number | undefined>; stats: ColumnStats }> =
    rows.map((r) => {
      // Map by lap number defensively (perLapValues is aligned, but be safe).
      const byLap = new Map<number, number | undefined>();
      for (const e of r.perLapValues) {
        byLap.set(e.lap, metric === "vMin" ? e.vMin : e.brakePointDist);
      }
      const values = validLapNumbers.map((l) => byLap.get(l));
      return { row: r, values, stats: columnStats(values) };
    });

  const [hover, setHover] = useState<CellInfo | null>(null);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto border border-ink/20 bg-card">
        <table className="w-full border-collapse font-mono text-[10px]">
          <thead>
            <tr className="border-b border-ink/30">
              <th className="sticky left-0 z-10 bg-card px-2 py-1 text-left uppercase tracking-widest text-muted-foreground">
                Lap \ Zona
              </th>
              {cols.map((c) => (
                <th
                  key={c.row.zone.index}
                  className="px-2 py-1 text-center uppercase tracking-widest text-muted-foreground"
                  title={`Zona ${c.row.label} — d start ${fmt(c.row.zone.startDist, 0)} m`}
                >
                  {c.row.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {validLapNumbers.map((lapNum, li) => (
              <tr key={lapNum} className="border-b border-ink/10">
                <td className="sticky left-0 z-10 bg-card px-2 py-1 text-left uppercase tracking-widest text-muted-foreground">
                  L{lapNum}
                </td>
                {cols.map((c) => {
                  const v = c.values[li];
                  const has = v !== undefined && Number.isFinite(v);
                  let bg = NEUTRAL_BG;
                  let norm: number | undefined;
                  if (has && c.stats.n >= 2 && c.stats.max > c.stats.min) {
                    const raw = (v as number - c.stats.min) / (c.stats.max - c.stats.min);
                    // For brakePointDist, EARLIER (smaller distance) = cooler;
                    // for vMin, slower = cooler. Both share the same raw mapping
                    // (low → cool, high → warm); the legend declares the meaning.
                    norm = raw;
                    bg = heatColor(raw);
                  } else if (has && c.stats.n === 1) {
                    // Single sample: use mid colour, no comparison possible.
                    norm = 0.5;
                    bg = heatColor(0.5);
                  }
                  const info: CellInfo = {
                    lap: lapNum,
                    label: c.row.label,
                    value: has ? (v as number) : undefined,
                    metric,
                    unit,
                    norm,
                  };
                  return (
                    <td
                      key={c.row.zone.index}
                      className="cursor-default px-1 py-1 text-center text-ink"
                      style={{ background: bg, minWidth: 44 }}
                      onMouseEnter={() => setHover(info)}
                      onMouseLeave={() => setHover((h) => (h === info ? null : h))}
                      onFocus={() => setHover(info)}
                      onBlur={() => setHover(null)}
                      title={
                        has
                          ? `L${lapNum} · ${c.row.label} · ${(v as number).toFixed(metric === "vMin" ? 0 : 0)} ${unit}`
                          : `L${lapNum} · ${c.row.label} · dato non disponibile`
                      }
                      tabIndex={0}
                    >
                      {has ? (v as number).toFixed(metric === "vMin" ? 0 : 0) : "·"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-column legend with actual min/max */}
      <div className="overflow-x-auto">
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
          {cols.map((c) => (
            <div key={c.row.zone.index} className="flex items-center gap-2">
              <span className="uppercase tracking-widest">{c.row.label}</span>
              <span className="inline-flex h-3 w-16 overflow-hidden border border-ink/20">
                <span style={{ background: heatColor(0), width: "20%" }} />
                <span style={{ background: heatColor(0.25), width: "20%" }} />
                <span style={{ background: heatColor(0.5), width: "20%" }} />
                <span style={{ background: heatColor(0.75), width: "20%" }} />
                <span style={{ background: heatColor(1), width: "20%" }} />
              </span>
              <span className="tabular-nums">
                {Number.isFinite(c.stats.min) ? c.stats.min.toFixed(metric === "vMin" ? 0 : 0) : "—"}
                {" – "}
                {Number.isFinite(c.stats.max) ? c.stats.max.toFixed(metric === "vMin" ? 0 : 0) : "—"}
                {" "}
                {unit}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Hover details */}
      <div className="min-h-[18px] font-mono text-[11px] text-ink">
        {hover ? (
          hover.value === undefined ? (
            <span className="text-muted-foreground">
              L{hover.lap} · {hover.label} — dato non disponibile (cella neutra, mai interpolata)
            </span>
          ) : (
            <span>
              <span className="uppercase tracking-widest text-muted-foreground">Cella ·</span>{" "}
              L{hover.lap} · {hover.label} ·{" "}
              {hover.metric === "vMin" ? "v min" : "punto frenata"}{" "}
              <span className="tabular-nums">
                {hover.value.toFixed(hover.metric === "vMin" ? 0 : 0)} {hover.unit}
              </span>
            </span>
          )
        ) : (
          <span className="text-muted-foreground">
            Passa sulle celle per leggere il valore esatto misurato.
          </span>
        )}
      </div>
    </div>
  );
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

  const [metric, setMetric] = useState<HeatMetric>("vMin");

  if (result.kind !== "ok") {
    return <Notice>{result.message}</Notice>;
  }

  const rows = result.rows ?? [];
  const validLapNumbers = result.validLapNumbers ?? [];
  if (rows.length === 0) {
    return <Notice>Nessuna zona-curva rilevata sul giro di riferimento.</Notice>;
  }

  const brakePointDispersed = highDispersionZones(rows, (r) => r.brakePointDist.std);
  const vMinDispersed = highDispersionZones(rows, (r) => r.vMin.std);
  const showThrottle = result.hasThrottle;
  const showAbs = result.hasAbs;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px]">
        <span className="uppercase tracking-widest text-muted-foreground">
          Riferimento · L{result.refLap?.lap} · lungh. giro {fmt(result.refLapLength, 0)} m ·
          {" "}{result.lapsConsidered} giri validi
        </span>
      </div>

      {/* Heatmap (giri × zone-curva) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Heatmap giri × zone — colore normalizzato per zona
          </h4>
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              metrica:
            </span>
            {(["vMin", "brakePointDist"] as const).map((opt) => (
              <Button
                key={opt}
                size="sm"
                variant={metric === opt ? "default" : "outline"}
                className="h-7 rounded-none font-mono text-[10px] uppercase tracking-widest"
                onClick={() => setMetric(opt)}
              >
                {opt === "vMin" ? "v min (km/h)" : "punto frenata (m)"}
              </Button>
            ))}
          </div>
        </div>

        {validLapNumbers.length === 0 ? (
          <Notice>Nessun giro valido da rappresentare.</Notice>
        ) : (
          <Heatmap rows={rows} validLapNumbers={validLapNumbers} metric={metric} />
        )}
      </div>

      {/* Tabelle numeriche per zona — invariate */}
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
        all'ingegnere. La <span className="font-bold">heatmap</span> normalizza
        il colore <span className="font-bold">per zona</span> (ogni curva ha il
        suo range naturale: una curva lenta e una veloce non sono confrontabili
        in valore assoluto), quindi il colore indica se quel giro è stato più
        veloce/lento (o più anticipato/posticipato sul punto frenata) rispetto
        al tipico di QUELLA curva. Celle neutre = dato non misurato per quella
        coppia (giro, zona): mai interpolato.
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
