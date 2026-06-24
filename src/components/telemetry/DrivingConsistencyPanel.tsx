// Driving Consistency panel — shows per-zone spatial dispersion (Part 1) and,
// when enough valid laps are available, the temporal drift between the first
// and second half of the stint (Part 2), plus a compact stint summary.
//
// All numbers come from buildDrivingConsistency, which reuses the per-zone
// signature aggregated by buildBrakingSignature. No invented thresholds —
// only sample statistics (mean, std, CV) and per-half deltas. The engineer
// reads the data and decides; the engine does not diagnose.

// Radar (Part 2) — overlays first-half vs second-half of the stint, one
// metric at a time, with one axis per corner. Each axis is normalised
// independently on its own range (combining the two halves of that zone) so
// the chart is readable even when corners have very different physical
// scales. Consequence (declared in the panel): the radar shows the RELATIVE
// shape of the first-vs-second comparison, NOT absolute values; the area
// and the distance from the centre are NOT physical quantities. Exact
// values remain available in the tooltip and in the table below.

import { useMemo, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
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
import { Button } from "@/components/ui/button";

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

/* ============================ Radar (Part 2) ============================ */

type RadarMetricKey = "vMin" | "brakePointDist" | "throttleReopenDist";

interface RadarMetricSpec {
  key: RadarMetricKey;
  label: string;
  unit: string;
  digits: number;
}

const RADAR_METRICS: RadarMetricSpec[] = [
  { key: "vMin", label: "v min", unit: "km/h", digits: 1 },
  { key: "brakePointDist", label: "punto frenata", unit: "m", digits: 0 },
  { key: "throttleReopenDist", label: "riapertura gas", unit: "m", digits: 0 },
];

function pickMetric(d: ZoneDrift, key: RadarMetricKey): MetricDrift {
  if (key === "vMin") return d.vMin;
  if (key === "brakePointDist") return d.brakePointDist;
  return d.throttleReopenDist;
}

interface RadarDatum {
  zone: string;
  first: number | null;
  second: number | null;
  firstReal: number | undefined;
  secondReal: number | undefined;
  delta: number | undefined;
  available: boolean;
}

/** Per-axis range = [min, max] of (first.mean, second.mean) with a small
 *  symmetric padding so values never collapse on the rim/centre. Both halves
 *  are projected to [0,1] in that axis. Returns null/undefined when the
 *  metric is unavailable for the zone (vertex falls to 0.5 with "n/d" label). */
function buildRadarData(drift: ZoneDrift[], key: RadarMetricKey): RadarDatum[] {
  return drift.map((d) => {
    const m = pickMetric(d, key);
    if (!m.available || !Number.isFinite(m.first.mean) || !Number.isFinite(m.second.mean)) {
      return {
        zone: d.label,
        first: null,
        second: null,
        firstReal: Number.isFinite(m.first.mean) ? m.first.mean : undefined,
        secondReal: Number.isFinite(m.second.mean) ? m.second.mean : undefined,
        delta: undefined,
        available: false,
      };
    }
    const a = m.first.mean;
    const b = m.second.mean;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    let span = hi - lo;
    if (span === 0) span = Math.max(1e-6, Math.abs(hi) * 0.05 + 1e-6);
    const pad = span * 0.25;
    const axisLo = lo - pad;
    const axisHi = hi + pad;
    const denom = axisHi - axisLo;
    const proj = (v: number) => (denom > 0 ? (v - axisLo) / denom : 0.5);
    return {
      zone: d.label,
      first: proj(a),
      second: proj(b),
      firstReal: a,
      secondReal: b,
      delta: b - a,
      available: true,
    };
  });
}

interface RadarTooltipPayloadItem {
  payload?: RadarDatum;
  name?: string;
}

function makeRadarTooltip(spec: RadarMetricSpec) {
  const TooltipContent = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: RadarTooltipPayloadItem[];
    label?: string;
  }) => {
    if (!active || !payload || payload.length === 0) return null;
    const p = payload[0]?.payload;
    if (!p) return null;
    const fmtReal = (v: number | undefined) =>
      v === undefined || !Number.isFinite(v) ? "n/d" : `${v.toFixed(spec.digits)} ${spec.unit}`;
    return (
      <div
        style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--ink) / 0.4)",
          borderRadius: 0,
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 11,
          padding: "6px 8px",
          color: "hsl(var(--ink))",
        }}
      >
        <div className="uppercase tracking-widest text-muted-foreground">
          {label ?? p.zone} · {spec.label}
        </div>
        <div>1ª metà: <span className="tabular-nums">{fmtReal(p.firstReal)}</span></div>
        <div>2ª metà: <span className="tabular-nums">{fmtReal(p.secondReal)}</span></div>
        <div>
          Δ:{" "}
          <span className="tabular-nums">
            {p.delta === undefined || !Number.isFinite(p.delta)
              ? "n/d"
              : `${p.delta > 0 ? "+" : ""}${p.delta.toFixed(spec.digits)} ${spec.unit}`}
          </span>
        </div>
        {!p.available && (
          <div className="text-muted-foreground">dato non disponibile in una delle metà</div>
        )}
      </div>
    );
  };
  return TooltipContent;
}

function DriftRadar({
  drift,
  spec,
}: {
  drift: ZoneDrift[];
  spec: RadarMetricSpec;
}) {
  const data = useMemo(() => buildRadarData(drift, spec.key), [drift, spec.key]);
  // For unavailable vertices, push to centre (0) instead of mid so the
  // missing data is visually evident without inventing a value.
  const chartData = data.map((d) => ({
    ...d,
    first: d.available ? d.first : 0,
    second: d.available ? d.second : 0,
  }));

  return (
    <div className="space-y-2">
      <div className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={chartData} outerRadius="75%">
            <PolarGrid stroke="hsl(var(--ink) / 0.2)" />
            <PolarAngleAxis
              dataKey="zone"
              tick={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10, fill: "hsl(var(--ink))" }}
            />
            <PolarRadiusAxis
              domain={[0, 1]}
              tick={false}
              axisLine={false}
            />
            <Radar
              name="1ª metà"
              dataKey="first"
              stroke="#1e6f8a"
              fill="#1e6f8a"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
            <Radar
              name="2ª metà"
              dataKey="second"
              stroke="hsl(var(--race-red))"
              fill="hsl(var(--race-red))"
              fillOpacity={0.25}
              isAnimationActive={false}
            />
            <Tooltip content={makeRadarTooltip(spec)} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3" style={{ background: "#1e6f8a" }} /> 1ª metà
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3" style={{ background: "hsl(var(--race-red))" }} /> 2ª metà
        </span>
        <span className="uppercase tracking-widest">
          Ogni asse è normalizzato sul proprio range (1ª + 2ª metà di quella zona) + padding 25%.
        </span>
      </div>
    </div>
  );
}

/** Fallback for stints with < 3 zones — a radar with 1–2 axes is degenerate.
 *  Per-zone side-by-side bars with real values, declared as such. */
function DriftBarsFallback({
  drift,
  spec,
}: {
  drift: ZoneDrift[];
  spec: RadarMetricSpec;
}) {
  const data = useMemo(() => buildRadarData(drift, spec.key), [drift, spec.key]);
  // Per-zone axis range for the bar width (same per-axis normalisation).
  return (
    <div className="space-y-2 border border-ink/15 p-3">
      <p className="font-mono text-[10px] text-muted-foreground">
        Meno di 3 zone disponibili: il radar è degenere, fallback a barre
        affiancate (1ª vs 2ª metà) per zona, con normalizzazione per-asse
        (range locale + padding).
      </p>
      <div className="space-y-2">
        {data.map((d) => {
          const firstPct = (d.first ?? 0) * 100;
          const secondPct = (d.second ?? 0) * 100;
          return (
            <div key={d.zone} className="font-mono text-[11px] text-ink">
              <div className="mb-1 flex items-center justify-between">
                <span className="uppercase tracking-widest text-muted-foreground">{d.zone}</span>
                <span className="tabular-nums">
                  {d.firstReal !== undefined ? d.firstReal.toFixed(spec.digits) : "n/d"} →{" "}
                  {d.secondReal !== undefined ? d.secondReal.toFixed(spec.digits) : "n/d"}{" "}
                  {spec.unit}
                  {d.delta !== undefined && Number.isFinite(d.delta) && (
                    <>
                      {" · Δ "}
                      <span className={d.delta < 0 ? "text-race-red" : ""}>
                        {d.delta > 0 ? "+" : ""}
                        {d.delta.toFixed(spec.digits)}
                      </span>
                    </>
                  )}
                </span>
              </div>
              <div className="space-y-1">
                <div className="h-2 w-full border border-ink/20 bg-card">
                  <div className="h-full" style={{ width: `${firstPct}%`, background: "#1e6f8a" }} />
                </div>
                <div className="h-2 w-full border border-ink/20 bg-card">
                  <div className="h-full" style={{ width: `${secondPct}%`, background: "hsl(var(--race-red))" }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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

  const availableRadarMetrics = useMemo<RadarMetricSpec[]>(
    () => RADAR_METRICS.filter((m) => m.key !== "throttleReopenDist" || showThrottle),
    [showThrottle],
  );
  const [radarMetricKey, setRadarMetricKey] = useState<RadarMetricKey>("vMin");
  const radarSpec =
    availableRadarMetrics.find((m) => m.key === radarMetricKey) ?? availableRadarMetrics[0];

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
