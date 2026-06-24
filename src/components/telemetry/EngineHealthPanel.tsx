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
  buildEngineHealth,
  type EngineMetricInfo,
  type EngineMetricKey,
} from "@/lib/ld/engineHealth";

const COLOR: Record<EngineMetricKey, string> = {
  waterTemp: "hsl(var(--race-red))",
  oilTemp: "#b67900",
  oilPress: "#1e6f8a",
  waterPress: "#2a7a3a",
  railPress: "#7a3d8a",
  fuelPress: "#3d6cc4",
};

function fmt(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(d);
}
function fmtAbs(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}

interface ChartRow {
  lap: number;
  [k: string]: number | undefined;
}

function buildChartData(
  metrics: EngineMetricInfo[],
  lapNumbers: number[],
): ChartRow[] {
  return lapNumbers.map((lap, i) => {
    const row: ChartRow = { lap };
    for (const m of metrics) {
      row[`${m.key}Avg`] = m.perLapAvg[i];
      row[`${m.key}Max`] = m.perLapMax[i];
    }
    return row;
  });
}

function GroupChart({
  metrics,
  data,
  unit,
  title,
}: {
  metrics: EngineMetricInfo[];
  data: ChartRow[];
  unit: string;
  title: string;
}) {
  const active = metrics.filter((m) => m.available);
  if (active.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        {title}: nessun canale disponibile in questo file.
      </p>
    );
  }
  if (data.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Nessun giro valido per costruire l'andamento.
      </p>
    );
  }
  // Show toolset alarm band only if EXACTLY one metric is plotted (otherwise bands overlap visually).
  const refRange = active.length === 1 ? active[0].alarmRange : undefined;

  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[10px] uppercase tracking-widest">
        <span className="text-muted-foreground">{title} ({unit}) · media per giro</span>
        {refRange && (
          <span className="text-race-red">
            ◉ Soglia toolset {fmtAbs(refRange.min, 1)}–{fmtAbs(refRange.max, 1)} {unit}
          </span>
        )}
      </div>
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
              width={48}
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
              formatter={(value: number, name: string) => [`${value.toFixed(1)} ${unit}`, name]}
            />
            <Legend
              wrapperStyle={{
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            />
            {active.map((m) => (
              <Line
                key={m.key}
                type="monotone"
                dataKey={`${m.key}Avg`}
                name={m.label}
                stroke={COLOR[m.key]}
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
    </div>
  );
}

export function EngineHealthPanel({
  file,
  laps,
  toolsetMeta,
}: {
  file: LdFile;
  laps: LapRow[];
  toolsetMeta?: ToolsetDisplayMeta[];
}) {
  const data = useMemo(
    () => buildEngineHealth(file, laps, toolsetMeta),
    [file, laps, toolsetMeta],
  );

  if (!data.hasAny) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Nessun canale di salute motore (temperatura/pressione) disponibile in questo file.
      </p>
    );
  }

  const tempMetrics: EngineMetricInfo[] = [data.metrics.waterTemp, data.metrics.oilTemp];
  const pressMetrics: EngineMetricInfo[] = [
    data.metrics.oilPress,
    data.metrics.waterPress,
    data.metrics.railPress,
    data.metrics.fuelPress,
  ];

  const chartTemp = buildChartData(tempMetrics, data.validLapNumbers);
  const chartPress = buildChartData(pressMetrics, data.validLapNumbers);

  const allMetrics: EngineMetricInfo[] = [
    data.metrics.waterTemp,
    data.metrics.oilTemp,
    data.metrics.oilPress,
    data.metrics.waterPress,
    data.metrics.railPress,
    data.metrics.fuelPress,
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GroupChart
          metrics={tempMetrics}
          data={chartTemp}
          unit="°C"
          title="Temperature motore"
        />
        <GroupChart
          metrics={pressMetrics}
          data={chartPress}
          unit="bar"
          title="Pressioni motore"
        />
      </div>

      <div className="border-t border-ink/20 pt-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-race-red">
          ◉ Sintesi oggettiva
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] font-mono text-xs">
            <thead>
              <tr className="border-b border-ink/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="py-1 pr-3 text-left">Parametro</th>
                <th className="py-1 pr-3 text-left">Canale</th>
                <th className="py-1 pr-3 text-right">Inizio (avg)</th>
                <th className="py-1 pr-3 text-right">Fine (avg)</th>
                <th className="py-1 pr-3 text-right">Δ</th>
                <th className="py-1 pr-3 text-right">Picco (max)</th>
                <th className="py-1 pr-3 text-left">Soglia toolset</th>
                <th className="py-1 text-left">Allarmi</th>
              </tr>
            </thead>
            <tbody>
              {allMetrics.map((m) => {
                const inAlarm = m.alarmLaps.length > 0;
                return (
                  <tr key={m.key} className="border-b border-ink/10">
                    <td className="py-1 pr-3">
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block h-2 w-2" style={{ background: m.available ? COLOR[m.key] : "hsl(var(--ink) / 0.3)" }} />
                        <span className={m.available ? "" : "text-muted-foreground line-through"}>{m.label}</span>
                      </span>
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {m.available ? m.channelName : "canale assente"}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">{fmtAbs(m.firstAvg, m.group === "temp" ? 1 : 2)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{fmtAbs(m.lastAvg, m.group === "temp" ? 1 : 2)}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{fmt(m.deltaAvg, m.group === "temp" ? 1 : 2)} {m.available ? m.unit : ""}</td>
                    <td className="py-1 pr-3 text-right tabular-nums">{fmtAbs(m.peakMax, m.group === "temp" ? 0 : 2)}</td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {m.alarmRange
                        ? `${fmtAbs(m.alarmRange.min, m.group === "temp" ? 0 : 1)}–${fmtAbs(m.alarmRange.max, m.group === "temp" ? 0 : 1)} ${m.unit}`
                        : "—"}
                    </td>
                    <td className={`py-1 ${inAlarm ? "text-race-red" : "text-muted-foreground"}`}>
                      {inAlarm
                        ? `L${m.alarmLaps.join(", L")}`
                        : m.alarmRange ? "nessuno" : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-3xl font-mono text-[10px] leading-relaxed text-muted-foreground">
          Vengono mostrati solo dati grezzi e andamenti reali. Le uniche soglie
          riportate sono quelle dichiarate dal toolset (alarm range significativo);
          per i parametri senza soglia dichiarata (es. pressione acqua) la
          finestra di riferimento non è nota e il giudizio resta all'ingegnere.
        </p>
      </div>
    </div>
  );
}
