// Weather Evolution panel — per-stint evolution of on-board environmental
// sensors (airTemp, humidity, airPressure, wet).
//
// Source: STRICTLY on-board sensors recorded during the session (PTH/wet).
// No network call, no external weather provider. When all four channels are
// missing, the section renders a neutral notice and nothing else. The
// integration with external weather data lives in a separate module that
// activates only when these on-board channels are absent.

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import {
  buildWeatherEvolution,
  WET_TRANSITION_PCT,
  type LapWeatherRow,
  type SeriesDelta,
} from "@/lib/ld/weatherEvolution";

function fmt(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}
function fmtSigned(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(d);
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-muted-foreground">{children}</p>;
}

function DeltaBlock({
  label,
  unit,
  d,
}: {
  label: string;
  unit: string;
  d: SeriesDelta | undefined;
}) {
  if (!d) {
    return (
      <div>
        <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-muted-foreground">—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-ink">
        {fmt(d.first, 1)} → {fmt(d.last, 1)} {unit}{" "}
        <span className={d.stable ? "text-muted-foreground" : "text-race-red"}>
          ({fmtSigned(d.delta, 1)} {unit})
        </span>
      </div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
        L{d.firstLap} → L{d.lastLap}
        {d.stable ? " · stabile" : ""}
      </div>
    </div>
  );
}

function tempChartData(perLap: LapWeatherRow[]) {
  return perLap.map((r) => ({
    lap: r.lap,
    mean: r.airTempMean ?? null,
    // ComposedChart Area uses [low, high] as a 2-element value
    band: r.airTempMin !== undefined && r.airTempMax !== undefined ? [r.airTempMin, r.airTempMax] : null,
  }));
}

const CHART_HEIGHT = 180;

function ChartShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

function xAxisProps() {
  return {
    dataKey: "lap",
    tickFormatter: (v: number) => `L${v}`,
    stroke: "hsl(var(--ink))",
    tick: { fontFamily: "var(--font-mono, monospace)", fontSize: 10 },
  } as const;
}

function yAxisProps(width = 42) {
  return {
    stroke: "hsl(var(--ink))",
    tick: { fontFamily: "var(--font-mono, monospace)", fontSize: 10 },
    width,
  } as const;
}

function tooltipProps(unit: string) {
  return {
    contentStyle: {
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--ink) / 0.4)",
      borderRadius: 0,
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 11,
    },
    labelFormatter: (v: number) => `Giro L${v}`,
    formatter: (value: number | [number, number], name: string) => {
      if (Array.isArray(value)) {
        return [`${value[0].toFixed(1)} – ${value[1].toFixed(1)} ${unit}`, name];
      }
      return [`${value.toFixed(1)} ${unit}`, name];
    },
  } as const;
}

export function WeatherEvolutionPanel({ file, laps }: { file: LdFile; laps: LapRow[] }) {
  const result = useMemo(() => buildWeatherEvolution(file, laps), [file, laps]);

  if (result.kind !== "ok") {
    return <Notice>{result.message}</Notice>;
  }

  const { perLap, summary, units, hasAirTemp, hasHumidity, hasAirPressure, hasWet } = result;
  void CHART_HEIGHT;

  const tempData = tempChartData(perLap);
  const humData = perLap.map((r) => ({ lap: r.lap, humidity: r.humidityMean ?? null }));
  const pressData = perLap.map((r) => ({ lap: r.lap, pressure: r.airPressureMean ?? null }));
  const wetData = perLap.map((r) => ({ lap: r.lap, wet: r.wetPct ?? null }));

  return (
    <div className="space-y-5">
      {/* Compact summary */}
      <div className="grid grid-cols-2 gap-3 border border-ink/15 bg-muted/20 p-3 font-mono text-[11px] md:grid-cols-4">
        <DeltaBlock label="Aria" unit={units.airTemp} d={summary.airTemp} />
        <DeltaBlock label="Umidità" unit={units.humidity} d={summary.humidity} />
        <DeltaBlock label="Pressione" unit={units.airPressure} d={summary.airPressure} />
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Wet (transizione)
          </div>
          {!hasWet ? (
            <div className="text-muted-foreground">—</div>
          ) : summary.wetTransition === null ? (
            <div className="text-ink">
              nessuna · media {fmt(summary.wetMeanPct, 1)}%
            </div>
          ) : summary.wetTransition ? (
            <div className="text-race-red">
              L{summary.wetTransition.lap} · {fmt(summary.wetTransition.wetPct, 0)}%
            </div>
          ) : (
            <div className="text-muted-foreground">—</div>
          )}
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            soglia ≥ {WET_TRANSITION_PCT}% campioni/giro
          </div>
        </div>
      </div>

      {summary.overallStable && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Condizioni sostanzialmente stabili nello stint (delta entro la
          banda derivata dai dati).
        </p>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {hasAirTemp && (
          <div>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Temperatura aria ({units.airTemp}) · banda min–max
            </h4>
            <ChartShell>
              <ComposedChart data={tempData} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--ink) / 0.15)" />
                <XAxis {...xAxisProps()} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...tooltipProps(units.airTemp)} />
                <Area
                  type="monotone"
                  dataKey="band"
                  name="Min–Max"
                  stroke="none"
                  fill="hsl(var(--ink) / 0.18)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="mean"
                  name="Media"
                  stroke="hsl(var(--race-red))"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ChartShell>
          </div>
        )}

        {hasHumidity && (
          <div>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Umidità ({units.humidity})
            </h4>
            <ChartShell>
              <LineChart data={humData} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--ink) / 0.15)" />
                <XAxis {...xAxisProps()} />
                <YAxis {...yAxisProps()} />
                <Tooltip {...tooltipProps(units.humidity)} />
                <Line
                  type="monotone"
                  dataKey="humidity"
                  name="Umidità"
                  stroke="#1e6f8a"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartShell>
          </div>
        )}

        {hasAirPressure && (
          <div>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Pressione aria{units.airPressure ? ` (${units.airPressure})` : ""}
            </h4>
            <ChartShell>
              <LineChart data={pressData} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--ink) / 0.15)" />
                <XAxis {...xAxisProps()} />
                <YAxis {...yAxisProps(54)} domain={["auto", "auto"]} />
                <Tooltip {...tooltipProps(units.airPressure)} />
                <Line
                  type="monotone"
                  dataKey="pressure"
                  name="Pressione"
                  stroke="#b67900"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartShell>
          </div>
        )}

        {hasWet && (
          <div>
            <h4 className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Bagnato (% campioni per giro con flag wet attivo)
            </h4>
            <ChartShell>
              <LineChart data={wetData} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--ink) / 0.15)" />
                <XAxis {...xAxisProps()} />
                <YAxis {...yAxisProps()} domain={[0, 100]} />
                <Tooltip {...tooltipProps("%")} />
                <Line
                  type="stepAfter"
                  dataKey="wet"
                  name="Wet %"
                  stroke="hsl(var(--race-red))"
                  strokeWidth={2.5}
                  dot={{ r: 3 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartShell>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <p className="max-w-4xl border-t border-ink/15 pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        I dati provengono dai sensori ambientali di bordo (PTH / wet)
        registrati durante la sessione: rappresentano la condizione misurata
        sull'auto e <span className="font-bold">non</span> la temperatura
        asfalto. La banda di stabilità (delta primo→ultimo giro valido) è
        derivata dai dati stessi (max tra una soglia minima e una frazione
        del valore medio); nessun limite assoluto è imposto. La{" "}
        <span className="font-bold">transizione bagnato</span> è il primo
        giro in cui i campioni con flag wet attivo superano il{" "}
        {WET_TRANSITION_PCT}% del giro — criterio dichiarato, non legale.
        Il giudizio strategico resta all'ingegnere. Quando questi canali non
        sono disponibili la sezione resta vuota: l'integrazione con dati
        meteo esterni verrà gestita da un modulo separato.
      </p>
    </div>
  );
}
