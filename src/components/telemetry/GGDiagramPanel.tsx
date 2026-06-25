// G-G Diagram panel — friction footprint visualisation.
//
// Renders the result of `buildGGDiagram` as a square G-G plot with:
//   • centred zero-cross axes (lat = horizontal, long = vertical),
//   • a half-G reference grid,
//   • either a density heatmap (aggregate) or a decimated scatter (single
//     lap / "scatter" mode),
//   • a side panel of OBSERVED envelope metrics (no theoretical reference).
//
// Anti-hallucination discipline (mirrors the engine): no synthetic max-grip
// ellipse, no automatic diagnosis, no setup interpretation. Empty regions
// are simply combinations of G that were not reached.

import { useMemo } from "react";
import { buildGGDiagram, type GGResult, type BuildGGOptions } from "@/lib/ld/ggDiagram";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";

export interface GGDiagramPanelProps {
  file: LdFile;
  laps: LapRow[];
  /** "density" = heatmap (recommended for aggregate). "scatter" = decimated dots (per-lap). */
  mode?: "density" | "scatter";
  /** Edge size in CSS pixels of the square plotting area. Default 360. */
  size?: number;
  /** Hide the side metrics panel (compact embedding in Lap Detail). */
  compact?: boolean;
  /** Optional override for engine options (point budget, cell size). */
  engineOptions?: BuildGGOptions;
  /** Subtitle / context line displayed under the title. */
  subtitle?: string;
}

const TICK_STEP = 0.5; // G

function fmtG(v: number, d = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)} G`;
}

function fmtAbs(v: number, d = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(d)} G`;
}

function unavailableMessage(r: GGResult): string {
  switch (r.reason) {
    case "missing-both":
      return "Canali di accelerazione (accLong, accLat) non disponibili nel file: il diagramma G-G non è costruibile.";
    case "missing-acclong":
      return "Canale di accelerazione longitudinale (accLong) non disponibile: il diagramma G-G non è costruibile.";
    case "missing-acclat":
      return "Canale di accelerazione laterale (accLat) non disponibile: il diagramma G-G non è costruibile.";
    case "no-laps":
      return "Nessun giro selezionato per il diagramma G-G.";
    case "no-samples":
      return "Nessun campione di accelerazione utile nei giri selezionati.";
    default:
      return "Diagramma G-G non disponibile.";
  }
}

export function GGDiagramPanel({
  file,
  laps,
  mode = "density",
  size = 360,
  compact = false,
  engineOptions,
  subtitle,
}: GGDiagramPanelProps) {
  const result = useMemo(
    () => buildGGDiagram(file, laps, engineOptions),
    [file, laps, engineOptions],
  );

  if (!result.available) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        {unavailableMessage(result)}
      </p>
    );
  }

  // Square symmetric G domain: max absolute G across all four extremes,
  // rounded up to the next TICK_STEP. The plot stays at 1:1 aspect so that
  // a circle of constant combined-G reads as a circle.
  const { envelope, density, pointsDecimated, source, pointCount, sampleRateHz } = result;
  const extreme = Math.max(
    envelope.maxBrake,
    envelope.maxAccel,
    envelope.maxLatLeft,
    envelope.maxLatRight,
    0.5,
  );
  const domain = Math.ceil(extreme / TICK_STEP) * TICK_STEP;
  const safeDomain = domain > 0 ? domain : TICK_STEP;

  const padding = 28;
  const inner = size;
  const total = inner + padding * 2;
  // Linear maps: lateral → svg-x (positive right); longitudinal → svg-y
  // (positive up, so we invert: brake at the bottom, accel at the top).
  const xScale = (g: number) => padding + ((g + safeDomain) / (2 * safeDomain)) * inner;
  const yScale = (g: number) => padding + (1 - (g + safeDomain) / (2 * safeDomain)) * inner;

  // Grid lines every TICK_STEP, from -safeDomain to +safeDomain.
  const ticks: number[] = [];
  for (let t = -safeDomain; t <= safeDomain + 1e-9; t += TICK_STEP) {
    ticks.push(Number(t.toFixed(3)));
  }

  return (
    <div className={`flex flex-wrap items-start ${compact ? "gap-3" : "gap-6"}`}>
      <div className="space-y-2">
        {subtitle && (
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {subtitle}
          </div>
        )}
        <svg
          width={total}
          height={total}
          viewBox={`0 0 ${total} ${total}`}
          role="img"
          aria-label="G-G diagram"
          className="block border border-ink/30 bg-card"
        >
          {/* Grid */}
          {ticks.map((g) => (
            <g key={`grid-${g}`}>
              <line
                x1={xScale(g)}
                y1={padding}
                x2={xScale(g)}
                y2={padding + inner}
                stroke="hsl(var(--ink) / 0.08)"
                strokeWidth={1}
              />
              <line
                x1={padding}
                y1={yScale(g)}
                x2={padding + inner}
                y2={yScale(g)}
                stroke="hsl(var(--ink) / 0.08)"
                strokeWidth={1}
              />
            </g>
          ))}

          {/* Zero-cross axes */}
          <line
            x1={xScale(0)}
            y1={padding}
            x2={xScale(0)}
            y2={padding + inner}
            stroke="hsl(var(--ink) / 0.5)"
            strokeWidth={1}
          />
          <line
            x1={padding}
            y1={yScale(0)}
            x2={padding + inner}
            y2={yScale(0)}
            stroke="hsl(var(--ink) / 0.5)"
            strokeWidth={1}
          />

          {/* Data layer */}
          {mode === "density"
            ? density.cells.map((c, i) => {
                const x = xScale(c.x - density.cellSize / 2);
                const y = yScale(c.y + density.cellSize / 2);
                const w = xScale(c.x + density.cellSize / 2) - x;
                const h = yScale(c.y - density.cellSize / 2) - y;
                const alpha =
                  density.maxCount > 0
                    ? 0.15 + 0.85 * Math.sqrt(c.count / density.maxCount)
                    : 0;
                return (
                  <rect
                    key={i}
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    fill={`hsl(var(--race-red) / ${alpha.toFixed(3)})`}
                  />
                );
              })
            : pointsDecimated.map((p, i) => (
                <circle
                  key={i}
                  cx={xScale(p.lat)}
                  cy={yScale(p.long)}
                  r={1.5}
                  fill="hsl(var(--race-red))"
                  fillOpacity={0.35}
                />
              ))}

          {/* Tick labels (every full G to keep it readable) */}
          {ticks
            .filter((g) => Math.abs(g - Math.round(g)) < 1e-6)
            .map((g) => (
              <g key={`lbl-${g}`}>
                <text
                  x={xScale(g)}
                  y={padding + inner + 14}
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                >
                  {g.toFixed(0)}
                </text>
                <text
                  x={padding - 6}
                  y={yScale(g) + 3}
                  textAnchor="end"
                  fontFamily="ui-monospace, monospace"
                  fontSize={9}
                  fill="hsl(var(--muted-foreground))"
                >
                  {g.toFixed(0)}
                </text>
              </g>
            ))}

          {/* Axis annotations (convention) */}
          <text
            x={padding + inner}
            y={yScale(0) - 4}
            textAnchor="end"
            fontFamily="ui-monospace, monospace"
            fontSize={9}
            fill="hsl(var(--ink) / 0.6)"
          >
            +Lat → DESTRA (G)
          </text>
          <text
            x={padding}
            y={yScale(0) + 12}
            textAnchor="start"
            fontFamily="ui-monospace, monospace"
            fontSize={9}
            fill="hsl(var(--ink) / 0.6)"
          >
            −Lat ← SINISTRA
          </text>
          <text
            x={xScale(0) + 4}
            y={padding + 10}
            textAnchor="start"
            fontFamily="ui-monospace, monospace"
            fontSize={9}
            fill="hsl(var(--ink) / 0.6)"
          >
            +Long ↑ ACCEL
          </text>
          <text
            x={xScale(0) + 4}
            y={padding + inner - 4}
            textAnchor="start"
            fontFamily="ui-monospace, monospace"
            fontSize={9}
            fill="hsl(var(--ink) / 0.6)"
          >
            −Long ↓ FRENATA
          </text>
        </svg>

        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {mode === "density"
            ? "mappa di densità — colore = quante volte la vettura è stata in quella combinazione di G"
            : "scatter decimato — un punto = un campione"}
          {" · "}
          {source ?? "—"} · {pointCount.toLocaleString()} campioni
          {sampleRateHz > 0 ? ` · base ${sampleRateHz} Hz` : ""}
        </div>
      </div>

      {!compact && (
        <div className="min-w-[180px] flex-1 space-y-3 font-mono text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Inviluppo osservato
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Metric label="Frenata max" value={fmtAbs(envelope.maxBrake)} />
              <Metric label="Accel. max" value={fmtAbs(envelope.maxAccel)} />
              <Metric label="Lat sx max" value={fmtAbs(envelope.maxLatLeft)} />
              <Metric label="Lat dx max" value={fmtAbs(envelope.maxLatRight)} />
              <Metric
                label="G combinato max"
                value={fmtAbs(envelope.maxCombined)}
                wide
              />
              <Metric
                label={`% sopra ${fmtG(envelope.combinedThreshold, 2)}`}
                value={`${(envelope.fractionAboveThreshold * 100).toFixed(1)} %`}
                wide
              />
            </div>
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Le accelerazioni sono misurate dall'IMU/logger. Il diagramma
            mostra l'impronta di aderenza reale: non esiste un riferimento
            di grip massimo teorico nei dati, l'inviluppo è quello
            osservato. Le zone vuote del diagramma indicano combinazioni di
            G non raggiunte — la loro interpretazione (margine residuo,
            stile di guida) resta all'ingegnere. Soglia G combinato:
            0,8 × massimo osservato (derivata dai dati, non un riferimento).
          </p>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`border border-ink/30 px-2 py-1 ${wide ? "col-span-2" : ""}`}
    >
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
