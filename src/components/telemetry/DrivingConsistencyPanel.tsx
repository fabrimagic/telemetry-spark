// Driving Consistency panel — shows per-zone spatial dispersion (Part 1) and,
// when enough valid laps are available, the temporal drift between the first
// and second half of the stint (Part 2), plus a compact stint summary.
//
// All numbers come from buildDrivingConsistency, which reuses the per-zone
// signature aggregated by buildBrakingSignature. No invented thresholds —
// only sample statistics (mean, std, CV) and per-half deltas. The engineer
// reads the data and decides; the engine does not diagnose.
//
// Part 1 graphic — per-zone BOX PLOT computed from the RAW per-lap values
// (SignatureRow.perLapValues, propagated through SpatialDispersionRow.
// perLapValues). Quartiles are REAL quartiles via linear interpolation
// (same scheme as engineUsage.quantile), NOT approximations from mean/std.
// Whisker convention: Tukey 1.5×IQR — points outside the fences are drawn
// as outliers, never invented. Y-axis scale is SHARED across zones for the
// selected metric so dispersion is visually comparable. When a zone has
// fewer than ~4 valid samples the box is statistically meaningless and is
// replaced by a strip of the raw individual points for that zone (declared
// as "n basso" in the tooltip). If every zone has too few samples, the
// entire view falls back to strip plots. The numeric tables below remain.

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

/* ===================== Box-plot (Part 1) ===================== */

type SpatialMetricKey = "brakePointDist" | "vMin";

interface SpatialMetricSpec {
  key: SpatialMetricKey;
  label: string;
  unit: string;
  digits: number;
}

const SPATIAL_METRICS: SpatialMetricSpec[] = [
  { key: "brakePointDist", label: "punto frenata", unit: "m", digits: 0 },
  { key: "vMin", label: "v min", unit: "km/h", digits: 1 },
];

const MIN_N_FOR_BOX = 4;

/** Linear-interpolation quantile (same scheme as engineUsage.quantile). */
function linQuantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

interface BoxStats {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Tukey whisker extremes (most extreme samples within ±1.5·IQR). */
  whiskerLo: number;
  whiskerHi: number;
  outliers: number[];
  /** Raw sorted values (used when n is too small for a real box). */
  values: number[];
}

function computeBoxStats(raw: number[]): BoxStats | null {
  const sorted = raw.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const q1 = linQuantile(sorted, 0.25);
  const median = linQuantile(sorted, 0.5);
  const q3 = linQuantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const inside = sorted.filter((v) => v >= lowerFence && v <= upperFence);
  const outliers = sorted.filter((v) => v < lowerFence || v > upperFence);
  const whiskerLo = inside.length > 0 ? inside[0] : sorted[0];
  const whiskerHi = inside.length > 0 ? inside[inside.length - 1] : sorted[sorted.length - 1];
  return {
    n: sorted.length,
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1],
    whiskerLo,
    whiskerHi,
    outliers,
    values: sorted,
  };
}

interface ZoneBoxData {
  zoneIndex: number;
  label: string;
  stats: BoxStats | null;
}

interface BoxTooltipState {
  x: number;
  y: number;
  zone: ZoneBoxData;
}

function SpatialBoxPlot({
  rows,
  spec,
}: {
  rows: SpatialDispersionRow[];
  spec: SpatialMetricSpec;
}) {
  const zoneData: ZoneBoxData[] = useMemo(
    () =>
      rows.map((r) => {
        const raw = r.perLapValues
          .map((p) => (spec.key === "vMin" ? p.vMin : p.brakePointDist))
          .filter((v): v is number => v !== undefined && Number.isFinite(v));
        return { zoneIndex: r.zoneIndex, label: r.label, stats: computeBoxStats(raw) };
      }),
    [rows, spec.key],
  );

  // Shared Y-axis range across all zones for the selected metric.
  const allValues: number[] = [];
  for (const z of zoneData) if (z.stats) allValues.push(...z.stats.values);
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  let span = dataMax - dataMin;
  if (span === 0) span = Math.max(1e-6, Math.abs(dataMax) * 0.05 + 1e-6);
  const padY = span * 0.1;
  const yLo = dataMin - padY;
  const yHi = dataMax + padY;

  const allLowN = zoneData.every((z) => !z.stats || z.stats.n < MIN_N_FOR_BOX);

  // SVG layout
  const W = Math.max(360, zoneData.length * 70 + 80);
  const H = 280;
  const padLeft = 56;
  const padRight = 16;
  const padTop = 14;
  const padBottom = 36;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const colW = zoneData.length > 0 ? plotW / zoneData.length : 0;
  const boxW = Math.min(36, colW * 0.5);

  const yScale = (v: number) => padTop + (1 - (v - yLo) / (yHi - yLo)) * plotH;

  const ticks: number[] = [];
  for (let i = 0; i <= 4; i++) ticks.push(yLo + ((yHi - yLo) * i) / 4);

  const [tip, setTip] = useState<BoxTooltipState | null>(null);
  const fmtV = (v: number) =>
    Number.isFinite(v) ? `${v.toFixed(spec.digits)} ${spec.unit}` : "n/d";

  return (
    <div className="space-y-2">
      <div className="relative overflow-x-auto border border-ink/15 bg-card">
        <svg width={W} height={H} className="block">
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                x2={W - padRight}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="hsl(var(--ink) / 0.12)"
                strokeDasharray="2 3"
              />
              <text
                x={padLeft - 6}
                y={yScale(t) + 3}
                textAnchor="end"
                fontFamily="var(--font-mono, monospace)"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
              >
                {t.toFixed(spec.digits)}
              </text>
            </g>
          ))}
          <text
            x={12}
            y={padTop + plotH / 2}
            transform={`rotate(-90 12 ${padTop + plotH / 2})`}
            textAnchor="middle"
            fontFamily="var(--font-mono, monospace)"
            fontSize={10}
            fill="hsl(var(--muted-foreground))"
          >
            {spec.label} ({spec.unit})
          </text>

          {zoneData.map((z, idx) => {
            const cx = padLeft + colW * (idx + 0.5);
            const s = z.stats;
            const handlers = {
              onMouseMove: (e: React.MouseEvent<SVGGElement>) => {
                const svgEl = e.currentTarget.ownerSVGElement as SVGSVGElement | null;
                if (!svgEl) return;
                const rect = svgEl.getBoundingClientRect();
                setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, zone: z });
              },
              onMouseLeave: () => setTip(null),
            };
            if (!s) {
              return (
                <g key={z.zoneIndex} {...handlers}>
                  <rect x={cx - colW / 2} y={padTop} width={colW} height={plotH} fill="transparent" />
                  <text
                    x={cx}
                    y={H - padBottom + 16}
                    textAnchor="middle"
                    fontFamily="var(--font-mono, monospace)"
                    fontSize={10}
                    fill="hsl(var(--muted-foreground))"
                  >
                    {z.label}
                  </text>
                  <text
                    x={cx}
                    y={padTop + plotH / 2}
                    textAnchor="middle"
                    fontFamily="var(--font-mono, monospace)"
                    fontSize={10}
                    fill="hsl(var(--muted-foreground))"
                  >
                    n/d
                  </text>
                </g>
              );
            }
            const isLowN = s.n < MIN_N_FOR_BOX;
            return (
              <g key={z.zoneIndex} {...handlers}>
                <rect x={cx - colW / 2} y={padTop} width={colW} height={plotH} fill="transparent" />
                {isLowN ? (
                  <>
                    {s.values.map((v, i) => (
                      <circle key={i} cx={cx} cy={yScale(v)} r={3} fill="hsl(var(--ink) / 0.7)" />
                    ))}
                    <text
                      x={cx}
                      y={padTop - 2}
                      textAnchor="middle"
                      fontFamily="var(--font-mono, monospace)"
                      fontSize={9}
                      fill="hsl(var(--race-red))"
                    >
                      n={s.n}
                    </text>
                  </>
                ) : (
                  <>
                    <line
                      x1={cx}
                      x2={cx}
                      y1={yScale(s.whiskerLo)}
                      y2={yScale(s.whiskerHi)}
                      stroke="hsl(var(--ink) / 0.6)"
                    />
                    <line
                      x1={cx - boxW / 3}
                      x2={cx + boxW / 3}
                      y1={yScale(s.whiskerHi)}
                      y2={yScale(s.whiskerHi)}
                      stroke="hsl(var(--ink) / 0.6)"
                    />
                    <line
                      x1={cx - boxW / 3}
                      x2={cx + boxW / 3}
                      y1={yScale(s.whiskerLo)}
                      y2={yScale(s.whiskerLo)}
                      stroke="hsl(var(--ink) / 0.6)"
                    />
                    <rect
                      x={cx - boxW / 2}
                      y={yScale(s.q3)}
                      width={boxW}
                      height={Math.max(1, yScale(s.q1) - yScale(s.q3))}
                      fill="hsl(var(--ink) / 0.15)"
                      stroke="hsl(var(--ink) / 0.6)"
                    />
                    <line
                      x1={cx - boxW / 2}
                      x2={cx + boxW / 2}
                      y1={yScale(s.median)}
                      y2={yScale(s.median)}
                      stroke="hsl(var(--ink))"
                      strokeWidth={2}
                    />
                    {s.outliers.map((v, i) => (
                      <circle key={i} cx={cx} cy={yScale(v)} r={2.5} fill="hsl(var(--race-red))" />
                    ))}
                  </>
                )}
                <text
                  x={cx}
                  y={H - padBottom + 16}
                  textAnchor="middle"
                  fontFamily="var(--font-mono, monospace)"
                  fontSize={10}
                  fill="hsl(var(--ink))"
                >
                  {z.label}
                </text>
              </g>
            );
          })}
        </svg>

        {tip && tip.zone.stats && (
          <div
            style={{
              position: "absolute",
              left: Math.min(tip.x + 12, W - 180),
              top: Math.max(8, tip.y - 8),
              pointerEvents: "none",
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--ink) / 0.4)",
              borderRadius: 0,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              padding: "6px 8px",
              color: "hsl(var(--ink))",
              minWidth: 160,
            }}
          >
            <div className="uppercase tracking-widest text-muted-foreground">
              {tip.zone.label} · {spec.label}
            </div>
            <div>
              n giri: <span className="tabular-nums">{tip.zone.stats.n}</span>
              {tip.zone.stats.n < MIN_N_FOR_BOX && (
                <span className="ml-1 text-race-red">(n basso)</span>
              )}
            </div>
            <div>min: <span className="tabular-nums">{fmtV(tip.zone.stats.min)}</span></div>
            <div>Q1: <span className="tabular-nums">{fmtV(tip.zone.stats.q1)}</span></div>
            <div>mediana: <span className="tabular-nums">{fmtV(tip.zone.stats.median)}</span></div>
            <div>Q3: <span className="tabular-nums">{fmtV(tip.zone.stats.q3)}</span></div>
            <div>max: <span className="tabular-nums">{fmtV(tip.zone.stats.max)}</span></div>
            {tip.zone.stats.outliers.length > 0 && (
              <div className="text-race-red">outlier: {tip.zone.stats.outliers.length}</div>
            )}
          </div>
        )}
      </div>
      <p className="font-mono text-[10px] text-muted-foreground">
        Box plot dai valori per-giro misurati: quartili reali (interpolazione
        lineare), scatola Q1–Q3, mediana evidenziata, baffi secondo la
        convenzione di Tukey (1.5×IQR); i punti oltre i baffi sono outlier
        (in rosso). Scala Y condivisa tra le zone per la metrica selezionata:
        le dispersioni sono confrontabili a colpo d'occhio. Zone con meno di{" "}
        {MIN_N_FOR_BOX} giri validi sono mostrate come punti grezzi (strip),
        senza scatola: i quartili su pochi campioni sarebbero ingannevoli.
        {allLowN && " Tutte le zone hanno pochi giri: vista a punti per tutte."}
      </p>
    </div>
  );
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

/** Shared-scale radar projection.
 *  All axes carry the same metric, so we compute a single [globalMin,
 *  globalMax] range over every available (first.mean, second.mean) across
 *  all zones, pad it by 10%, and project every value into [0,1] on that
 *  shared scale. This makes the radial distance between the two halves on
 *  each axis proportional to the REAL drift of that zone. Unavailable
 *  zones get a neutral vertex (null → centre upstream) without inventing
 *  values. */
function buildRadarData(drift: ZoneDrift[], key: RadarMetricKey): RadarDatum[] {
  const reals: number[] = [];
  for (const d of drift) {
    const m = pickMetric(d, key);
    if (!m.available) continue;
    if (Number.isFinite(m.first.mean)) reals.push(m.first.mean);
    if (Number.isFinite(m.second.mean)) reals.push(m.second.mean);
  }
  let lo = reals.length > 0 ? Math.min(...reals) : 0;
  let hi = reals.length > 0 ? Math.max(...reals) : 1;
  let span = hi - lo;
  if (span === 0) span = Math.max(1e-6, Math.abs(hi) * 0.05 + 1e-6);
  const pad = span * 0.1;
  lo -= pad;
  hi += pad;
  const denom = hi - lo;
  const proj = (v: number) => (denom > 0 ? (v - lo) / denom : 0.5);

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
          Scala condivisa tra le zone per la metrica selezionata (min/max globale + padding 10%): la distanza tra 1ª e 2ª metà su ciascun asse riflette l'entità reale della deriva. Curve lente e veloci stanno a raggi diversi perché hanno livelli assoluti diversi — è fisica, non un difetto. L'area complessiva non è una grandezza fisica.
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
        affiancate (1ª vs 2ª metà) per zona, con scala condivisa tra le zone
        sulla metrica selezionata (min/max globale + padding 10%).
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

  const [spatialMetricKey, setSpatialMetricKey] = useState<SpatialMetricKey>("brakePointDist");
  const spatialSpec =
    SPATIAL_METRICS.find((m) => m.key === spatialMetricKey) ?? SPATIAL_METRICS[0];

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

            {/* Radar (or fallback bars) — overlay 1ª vs 2ª metà, one metric at a time */}
            {radarSpec && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h5 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Confronto 1ª vs 2ª metà — assi = zone-curva
                  </h5>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      metrica:
                    </span>
                    {availableRadarMetrics.map((m) => (
                      <Button
                        key={m.key}
                        size="sm"
                        variant={radarMetricKey === m.key ? "default" : "outline"}
                        className="h-7 rounded-none font-mono text-[10px] uppercase tracking-widest"
                        onClick={() => setRadarMetricKey(m.key)}
                      >
                        {m.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {drift.length >= 3 ? (
                  <DriftRadar drift={drift} spec={radarSpec} />
                ) : (
                  <DriftBarsFallback drift={drift} spec={radarSpec} />
                )}
              </div>
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
        un'osservazione dei dati e non una diagnosi. Il{" "}
        <span className="font-bold">radar</span> normalizza{" "}
        <span className="font-bold">ogni asse (zona) indipendentemente</span> sul
        range locale dei due valori (1ª + 2ª metà di quella zona) con un padding
        del 25%: mostra quindi la <span className="font-bold">forma relativa</span>{" "}
        del confronto, non valori assoluti. L'area racchiusa e la distanza dal
        centro <span className="font-bold">non</span> sono grandezze fisiche; i
        valori reali restano nel tooltip e nella tabella sottostante. Il
        giudizio resta all'ingegnere.
      </p>

    </div>
  );
}
