import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
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
  buildTyreEvolution,
  type TyreEvolutionSeries,
  type WheelKey,
} from "@/lib/ld/tyreEvolution";

const WHEELS: WheelKey[] = ["fl", "fr", "rl", "rr"];
const WHEEL_LABEL: Record<WheelKey, string> = {
  fl: "FL",
  fr: "FR",
  rl: "RL",
  rr: "RR",
};
// Distinct, accessible colors that fit the paper / race-red palette.
const WHEEL_COLOR: Record<WheelKey, string> = {
  fl: "hsl(var(--race-red))",
  fr: "#1e6f8a",
  rl: "#b67900",
  rr: "#2a7a3a",
};

function fmt(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(d);
}
function fmtAbs(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

function EvolutionChart({
  series,
  unit,
  yLabel,
}: {
  series: TyreEvolutionSeries;
  unit: string;
  yLabel: string;
}) {
  const data = series.perLap.map((p) => ({ ...p }));
  const activeWheels = WHEELS.filter((w) => series.sensorAvailable[w]);

  if (data.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Nessun giro valido disponibile.
      </p>
    );
  }

  if (activeWheels.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Nessun sensore {yLabel.toLowerCase()} disponibile.
      </p>
    );
  }

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--ink) / 0.15)" />
          <XAxis
            dataKey="lap"
            tickFormatter={(v) => `L${v}`}
            stroke="hsl(var(--ink))"
            tick={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}
          />
          <YAxis
            stroke="hsl(var(--ink))"
            tick={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}
            width={42}
            tickFormatter={(v) => `${v}`}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--ink) / 0.4)",
              borderRadius: 0,
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
            }}
            labelFormatter={(v) => `Giro L${v}`}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)} ${unit}`,
              name,
            ]}
          />
          <Legend
            wrapperStyle={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          />
          {activeWheels.map((w) => (
            <Line
              key={w}
              type="monotone"
              dataKey={w}
              name={WHEEL_LABEL[w]}
              stroke={WHEEL_COLOR[w]}
              strokeWidth={2}
              dot={{ r: 2.5 }}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function SensorStatusList({
  series,
  unit,
}: {
  series: TyreEvolutionSeries;
  unit: string;
}) {
  void unit;
  return (
    <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-widest">
      {WHEELS.map((w) => {
        const ok = series.sensorAvailable[w];
        return (
          <li key={w} className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2"
              style={{ background: ok ? WHEEL_COLOR[w] : "hsl(var(--ink) / 0.3)" }}
            />
            <span className={ok ? "" : "text-muted-foreground line-through"}>
              {WHEEL_LABEL[w]}
            </span>
            {!ok && (
              <span className="normal-case tracking-normal text-muted-foreground">
                · sensore non disponibile{
                  series.unavailableReason[w] ? ` (${series.unavailableReason[w]})` : ""
                }
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function TyreEvolutionPanel({
  file,
  laps,
}: {
  file: LdFile;
  laps: LapRow[];
}) {
  const evo = useMemo(() => buildTyreEvolution(file, laps), [file, laps]);

  if (!evo.hasTpms) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Canali TPMS non presenti in questo file.
      </p>
    );
  }

  const { temp, press, summary } = evo;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Temperatura gomme (°C) · per giro
          </div>
          <EvolutionChart series={temp} unit="°C" yLabel="Temperatura" />
          <SensorStatusList series={temp} unit="°C" />
        </div>
        <div className="min-w-0">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Pressione gomme (bar) · per giro
          </div>
          <EvolutionChart series={press} unit="bar" yLabel="Pressione" />
          <SensorStatusList series={press} unit="bar" />
        </div>
      </div>

      <div className="border-t border-ink/20 pt-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-race-red">
          ◉ Sintesi oggettiva
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Warm-up stimato</dt>
            <dd className="tabular-nums">
              {summary.warmupLaps !== undefined ? `${summary.warmupLaps} giri` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Δ asse F–R medio</dt>
            <dd className="tabular-nums">
              {summary.axleDeltaAvg !== undefined
                ? `${fmt(summary.axleDeltaAvg, 1)} °C${
                    summary.axleDeltaPartial
                      ? summary.axleDeltaSides?.left && !summary.axleDeltaSides?.right
                        ? " (solo lato sx)"
                        : summary.axleDeltaSides?.right && !summary.axleDeltaSides?.left
                          ? " (solo lato dx)"
                          : " (parziale — confronto non simmetrico)"
                      : ""
                  }`
                : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Δ lato L–R medio</dt>
            <dd className="tabular-nums">
              {summary.sideDeltaAvg !== undefined
                ? `${fmt(summary.sideDeltaAvg, 1)} °C${
                    summary.sideDeltaPartial
                      ? summary.sideDeltaAxles?.front && !summary.sideDeltaAxles?.rear
                        ? " (solo ant.)"
                        : summary.sideDeltaAxles?.rear && !summary.sideDeltaAxles?.front
                          ? " (solo post.)"
                          : " (parziale — confronto non simmetrico)"
                      : ""
                  }`
                : "—"}
            </dd>
          </div>

          {WHEELS.filter((w) => summary.totalTempDelta[w] !== undefined).map((w) => (
            <div key={w} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">
                ΔT totale {WHEEL_LABEL[w]}
              </dt>
              <dd className="tabular-nums">
                {fmt(summary.totalTempDelta[w], 1)} °C
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 max-w-3xl font-mono text-[10px] leading-relaxed text-muted-foreground">
          Solo evoluzione osservata e squilibri oggettivi. La finestra operativa
          ottimale delle gomme non è disponibile nei dati: il giudizio resta
          all'ingegnere. Valore di riferimento: {fmtAbs(temp.perLap.length, 0)}{" "}
          giri validi analizzati.
        </p>
      </div>
    </div>
  );
}
