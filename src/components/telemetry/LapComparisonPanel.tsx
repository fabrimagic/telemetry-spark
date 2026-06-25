// Lap Comparison panel — overlays the selected lap and the fastest valid lap
// of the stint spatially (vs lap distance) and quantifies per-corner deltas.
//
// Assumptions / disclaimers (also surfaced in the UI):
//  - Comparison is purely spatial, anchored to measured channels.
//  - Per-zone Δt is an ESTIMATE derived from velocity integration
//    (Σ Δ(1/v)·Δs); the file does not contain ms-precision lap timing.
//  - When a channel is missing, the relative trace / metric is omitted
//    with a neutral placeholder; no fake zeros, no invented thresholds.

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
import {
  buildLapComparison,
  buildOverlay,
  type ComparisonChannelKey,
  type LapComparisonResult,
} from "@/lib/ld/lapComparison";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const COLOR_REF = "#facc15"; // bright amber-yellow, highly visible against dark theme
const COLOR_SEL = "#1f4a8a"; // cool blue, distinct from race-red
const COLOR_ZONE = "hsl(var(--ink) / 0.08)";

function fmt(n: number | undefined | null, d = 1): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}
function fmtSigned(n: number | undefined | null, d = 1): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return (n >= 0 ? "+" : "") + n.toFixed(d);
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs text-muted-foreground">{children}</p>
  );
}

function Disclaimer() {
  return (
    <p className="mt-4 max-w-4xl border-t border-ink/15 pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
      Confronto puramente spaziale basato su canali misurati. I Δt per zona sono
      una <b>stima</b> derivata dall'integrazione della velocità
      (Σ Δ(1/v)·Δs): i tempi al millisecondo non sono presenti nel file. Il
      giudizio finale resta all'ingegnere.
    </p>
  );
}

interface OverlayChartProps {
  result: LapComparisonResult;
  channel: ComparisonChannelKey;
  unit: string;
  title: string;
  yDecimals?: number;
}

function OverlayChart({ result, channel, unit, title, yDecimals = 1 }: OverlayChartProps) {
  const data = useMemo(() => buildOverlay(result, channel, 700), [result, channel]);
  const zones = result.zones ?? [];

  const hasAny = data.some((p) => p.ref !== undefined || p.sel !== undefined);
  if (!hasAny) {
    return (
      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {title}
        </div>
        <Notice>Canale non disponibile.</Notice>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--ink) / 0.15)" />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v: number) => `${Math.round(v)}`}
              stroke="hsl(var(--ink))"
              tick={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}
            />
            <YAxis
              stroke="hsl(var(--ink))"
              tick={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}
              width={42}
              tickFormatter={(v: number) => v.toFixed(yDecimals)}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--ink) / 0.4)",
                borderRadius: 0,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 11,
              }}
              labelFormatter={(v: number) => `d = ${Math.round(v)} m`}
              formatter={(value: number, name: string) => [
                `${value.toFixed(yDecimals)} ${unit}`,
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
            {zones.map((z) => (
              <ReferenceArea
                key={z.index}
                x1={z.startDist}
                x2={z.endDist}
                fill={COLOR_ZONE}
                stroke="none"
                ifOverflow="hidden"
                label={{
                  value: `Z${z.index}`,
                  position: "insideTop",
                  fontSize: 9,
                  fontFamily: "var(--font-mono, monospace)",
                  fill: "hsl(var(--ink) / 0.55)",
                }}
              />
            ))}
            <Line
              type="monotone"
              dataKey="ref"
              name="Riferimento"
              stroke={COLOR_REF}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="sel"
              name="Selezionato"
              stroke={COLOR_SEL}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function LapComparisonPanel({
  file,
  laps,
  selectedLap,
}: {
  file: LdFile;
  laps: LapRow[];
  selectedLap: number | "all";
}) {
  const refLap = useMemo(
    () => laps.find((l) => l.isFastest && l.isValidLap) ?? null,
    [laps],
  );
  const selLap = useMemo(
    () =>
      selectedLap === "all"
        ? null
        : laps.find((l) => l.lap === selectedLap) ?? null,
    [laps, selectedLap],
  );

  const result = useMemo(
    () => buildLapComparison(file, refLap, selLap),
    [file, refLap, selLap],
  );

  if (selectedLap === "all") {
    return (
      <Notice>
        Seleziona un giro dalla Lap Table per confrontarlo con il giro più
        veloce dello stint.
      </Notice>
    );
  }

  if (result.kind === "no-lap-distance") {
    return <Notice>{result.message}</Notice>;
  }
  if (result.kind === "no-reference") {
    return <Notice>{result.message}</Notice>;
  }
  if (result.kind === "self-comparison") {
    return <Notice>{result.message}</Notice>;
  }
  if (result.kind === "no-coverage") {
    return <Notice>{result.message}</Notice>;
  }

  const { zones = [], zoneDeltas = [], totalDtEstimate, availability, partial, refLap: r, selLap: s } = result;
  const zoneFromSpeed = zones.length > 0 && zones[0].fromSpeed;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px]">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-4" style={{ background: COLOR_REF }} />
          <span className="uppercase tracking-widest">
            Riferimento · L{r?.lap} (fastest)
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-4" style={{ background: COLOR_SEL }} />
          <span className="uppercase tracking-widest">
            Selezionato · L{s?.lap}
          </span>
        </span>
        {partial && (
          <span className="border border-race-red px-2 py-0.5 text-[10px] uppercase tracking-widest text-race-red">
            confronto parziale ({Math.round((result.selected?.coverage ?? 0) * 100)}% copertura)
          </span>
        )}
        {zoneFromSpeed && (
          <span className="text-muted-foreground">
            Zone derivate dai minimi di velocità (canali freni assenti).
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <OverlayChart
          result={result}
          channel="speed"
          unit="km/h"
          title="Velocità vs distanza (m)"
          yDecimals={0}
        />
        <OverlayChart
          result={result}
          channel="throttle"
          unit="%"
          title="Acceleratore vs distanza (m)"
          yDecimals={0}
        />
        <OverlayChart
          result={result}
          channel="brakePressFront"
          unit="bar"
          title="Brake Press F vs distanza (m)"
          yDecimals={1}
        />
        <OverlayChart
          result={result}
          channel="brakePressRear"
          unit="bar"
          title="Brake Press R vs distanza (m)"
          yDecimals={1}
        />
        <OverlayChart
          result={result}
          channel="steeringAngle"
          unit="°"
          title="Angolo di sterzo vs distanza (m)"
          yDecimals={1}
        />
      </div>

      <div>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-race-red">
          ◉ Delta per zona-curva
        </div>
        {zones.length === 0 ? (
          <Notice>
            Nessuna zona-curva rilevata sul giro di riferimento (segnale troppo
            piatto o canali insufficienti).
          </Notice>
        ) : (
          <>
            <div className="overflow-x-auto border border-ink/20">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-ink/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest">Zona</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">d brake rif (m)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">d brake sel (m)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δ brake (m)</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">v min rif</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">v min sel</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δ v min</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-right">Δt stimato (s)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zoneDeltas.map((d) => {
                    const dtCls = !Number.isFinite(d.dtEstimate)
                      ? ""
                      : d.dtEstimate > 0.02
                        ? "text-race-red font-bold"
                        : d.dtEstimate < -0.02
                          ? "text-emerald-700 font-bold"
                          : "";
                    return (
                      <TableRow key={d.zone.index} className="border-b border-ink/10">
                        <TableCell className="font-mono text-xs tabular-nums">Z{d.zone.index}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(d.refBrakeDist, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(d.selBrakeDist, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmtSigned(d.brakeDistDelta, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(d.zone.vMin, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(d.selVMin, 0)}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{fmtSigned(d.vMinDelta, 0)}</TableCell>
                        <TableCell className={`text-right font-mono text-xs tabular-nums ${dtCls}`}>
                          {fmtSigned(d.dtEstimate, 2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 font-mono text-xs">
              <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
                Δ brake: positivo = il selezionato frena <b>dopo</b> il riferimento. Δt: positivo = il selezionato <b>perde</b> tempo.
              </span>
              <span>
                Σ Δt stimato (da velocità):{" "}
                <b className={
                  Number.isFinite(totalDtEstimate) && totalDtEstimate! > 0.05
                    ? "text-race-red"
                    : Number.isFinite(totalDtEstimate) && totalDtEstimate! < -0.05
                      ? "text-emerald-700"
                      : ""
                }>
                  {fmtSigned(totalDtEstimate, 2)} s
                </b>
              </span>
            </div>
          </>
        )}
      </div>

      <Disclaimer />
    </div>
  );
}
