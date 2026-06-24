import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import {
  buildBrakeManagement,
  type WheelKey,
} from "@/lib/ld/brakeManagement";

const WHEELS: WheelKey[] = ["fl", "fr", "rl", "rr"];
const WHEEL_LABEL: Record<WheelKey, string> = { fl: "FL", fr: "FR", rl: "RL", rr: "RR" };
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

export function BrakeManagementPanel({
  file,
  laps,
  toolsetMeta,
}: {
  file: LdFile;
  laps: LapRow[];
  toolsetMeta?: ToolsetDisplayMeta[];
}) {
  const data = useMemo(
    () => buildBrakeManagement(file, laps, toolsetMeta),
    [file, laps, toolsetMeta],
  );

  if (!data.hasAny) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Nessun canale temperatura disco freno disponibile in questo file.
      </p>
    );
  }

  const { perLap, available, alarmRange, summary, channelName, reason } = data;
  const activeWheels = WHEELS.filter((w) => available[w]);
  // Toolset alarm range to show as reference band: union of available corner ranges (only if all close).
  // Simpler: pick the FL alarm if present, else first available.
  const refRange =
    alarmRange.fl ?? alarmRange.fr ?? alarmRange.rl ?? alarmRange.rr;

  return (
    <div className="space-y-5">
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[10px] uppercase tracking-widest">
          <span className="text-muted-foreground">Temperatura disco freno (°C) · max per giro</span>
          {refRange && (
            <span className="text-race-red">
              ◉ Soglia toolset {fmtAbs(refRange.min, 0)}–{fmtAbs(refRange.max, 0)} °C
            </span>
          )}
        </div>
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={perLap} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
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
              />
              {refRange && (
                <ReferenceArea
                  y1={refRange.min}
                  y2={refRange.max}
                  fill="hsl(var(--race-red))"
                  fillOpacity={0.06}
                  stroke="hsl(var(--race-red))"
                  strokeOpacity={0.25}
                  strokeDasharray="3 3"
                />
              )}
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--ink) / 0.4)",
                  borderRadius: 0,
                  fontFamily: "var(--font-mono, monospace)",
                  fontSize: 11,
                }}
                labelFormatter={(v) => `Giro L${v}`}
                formatter={(value: number, name: string) => [`${value.toFixed(0)} °C`, name]}
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
                  dataKey={`${w}Max`}
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
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-widest">
          {WHEELS.map((w) => {
            const ok = available[w];
            return (
              <li key={w} className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2"
                  style={{ background: ok ? WHEEL_COLOR[w] : "hsl(var(--ink) / 0.3)" }}
                />
                <span className={ok ? "" : "text-muted-foreground line-through"}>
                  {WHEEL_LABEL[w]}
                </span>
                {ok ? (
                  <span className="normal-case tracking-normal text-muted-foreground">
                    · {channelName[w]}
                  </span>
                ) : (
                  <span className="normal-case tracking-normal text-muted-foreground">
                    · canale non disponibile{reason[w] ? ` (${reason[w]})` : ""}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-ink/20 pt-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-race-red">
          ◉ Sintesi oggettiva
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-xs sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Δ asse F–R medio (max)</dt>
            <dd className="tabular-nums">
              {summary.axleDeltaAvg !== undefined ? `${fmt(summary.axleDeltaAvg, 1)} °C` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Δ asse · primo giro</dt>
            <dd className="tabular-nums">
              {summary.axleDeltaFirst !== undefined ? `${fmt(summary.axleDeltaFirst, 1)} °C` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Δ asse · ultimo giro</dt>
            <dd className="tabular-nums">
              {summary.axleDeltaLast !== undefined ? `${fmt(summary.axleDeltaLast, 1)} °C` : "—"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Δ lato L–R medio (max)</dt>
            <dd className="tabular-nums">
              {summary.sideDeltaAvg !== undefined ? `${fmt(summary.sideDeltaAvg, 1)} °C` : "—"}
            </dd>
          </div>
          {WHEELS.filter((w) => summary.totalMaxDelta[w] !== undefined).map((w) => (
            <div key={w} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">ΔT max totale {WHEEL_LABEL[w]}</dt>
              <dd className="tabular-nums">{fmt(summary.totalMaxDelta[w], 0)} °C</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 max-w-3xl font-mono text-[10px] leading-relaxed text-muted-foreground">
          Solo evoluzione osservata e squilibri oggettivi. La finestra operativa
          ottimale dei dischi non è dichiarata nel toolset: il giudizio resta
          all'ingegnere. {refRange
            ? "La banda mostrata è la soglia di allarme dichiarata dal toolset."
            : "Nessuna soglia di allarme dichiarata dal toolset per questi canali."}
        </p>
      </div>
    </div>
  );
}
