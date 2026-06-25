// Suspension & Platform panel.
//
// Section A (reliable): per-wheel travel work, axle/side balance, and a
// CALCULATED dynamic rake index (relative platform variation, not absolute).
// Section B (raw / informative): per-lap mean of raw ride-height channels,
// explicitly labelled as not calibrated. No setup verdicts are produced.

import { useMemo } from "react";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { buildSuspension, type WheelKey } from "@/lib/ld/suspension";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
  Legend,
} from "recharts";

const WHEELS: WheelKey[] = ["fl", "fr", "rl", "rr"];
const WHEEL_LABEL: Record<WheelKey, string> = {
  fl: "FL", fr: "FR", rl: "RL", rr: "RR",
};
const WHEEL_COLOR: Record<WheelKey, string> = {
  fl: "#0ea5e9", // sky
  fr: "#f59e0b", // amber
  rl: "#10b981", // emerald
  rr: "#ef4444", // red
};

function fmt(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}
function fmtSigned(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}`;
}
function fmtPct(frac: number | undefined): string {
  if (frac === undefined || !Number.isFinite(frac)) return "—";
  return `${(frac * 100).toFixed(0)}%`;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-muted-foreground">{children}</p>;
}

export function SuspensionPanel({
  file,
  laps,
}: {
  file: LdFile;
  laps: LapRow[];
}) {
  const result = useMemo(() => buildSuspension(file, laps), [file, laps]);

  const Disclaimer = (
    <div className="border border-ink/15 bg-muted/30 p-3">
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-bold text-ink">Nota interpretativa.</span> Le
        corse sospensione sono <span className="font-bold">misure dirette</span>{" "}
        e affidabili; i ride height sono <span className="font-bold">grezzi
        non calibrati</span>; il rake mostrato è una{" "}
        <span className="font-bold">variazione relativa calcolata</span> dalle
        corse, non un valore assoluto in mm/gradi. Da questi soli dati{" "}
        <span className="font-bold">nessuna indicazione di setup</span> (es.
        durezza molle) è derivabile: il giudizio resta all'ingegnere.
      </p>
    </div>
  );

  if (!result.hasTravel && !result.hasRideHeight) {
    return (
      <div className="space-y-4">
        {Disclaimer}
        <Notice>
          Nessun canale di corsa ammortizzatore né ride height disponibile nel
          file caricato. Sezione non rappresentabile.
        </Notice>
      </div>
    );
  }

  // ---- Per-lap range chart data (Section A) ----
  const rangeChartData: Array<Record<string, number | undefined>> = (() => {
    const lapSet = new Set<number>();
    for (const w of WHEELS) {
      if (!result.travel[w].available) continue;
      for (const p of result.travel[w].perLap) lapSet.add(p.lap);
    }
    const sorted = [...lapSet].sort((a, b) => a - b);
    return sorted.map((lap) => {
      const row: Record<string, number | undefined> = { lap };
      for (const w of WHEELS) {
        const stat = result.travel[w].perLap.find((p) => p.lap === lap);
        row[w] = stat ? stat.range : undefined;
      }
      return row;
    });
  })();

  // ---- Dynamic rake chart data ----
  const rakeChartData = result.dynamicRake.perLap.map((p) => ({
    lap: p.lap,
    delta: p.delta,
  }));

  // ---- Box-plot-like summary (min / median / max) per wheel from per-lap min/max ----
  const distData = WHEELS.filter((w) => result.travel[w].available).map((w) => {
    const s = result.travel[w];
    const mins = s.perLap.map((p) => p.min);
    const maxs = s.perLap.map((p) => p.max);
    const lo = Math.min(...mins);
    const hi = Math.max(...maxs);
    return {
      wheel: WHEEL_LABEL[w],
      key: w,
      low: lo,
      high: hi,
      span: hi - lo,
      compFrac: s.meanCompressionFrac,
      extFrac: s.meanExtensionFrac,
    };
  });

  // ---- Section B (raw ride-height) per-lap chart ----
  const rhWheels = WHEELS.filter((w) => result.rideHeightAvailable[w]);
  const rhChartData = result.rideHeight.perLap.map((p) => {
    const row: Record<string, number | undefined> = { lap: p.lap };
    for (const w of rhWheels) row[w] = p[w];
    return row;
  });

  return (
    <div className="space-y-6">
      {Disclaimer}

      {/* ============ SECTION A — RELIABLE ============ */}
      {result.hasTravel ? (
        <section className="space-y-4 border-l-2 border-emerald-600/60 pl-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-emerald-700">
              Sezione A · Affidabile
            </div>
            <h4 className="font-display text-xl tracking-wider">
              Lavoro sospensioni (da corse ammortizzatore)
            </h4>
            <p className="font-mono text-[10px] text-muted-foreground">
              Riferimento zero per compressione/estensione: mediana per giro
              (data-derived, non assoluto). Convenzione: + sopra mediana =
              compressione, − sotto mediana = estensione.
            </p>
          </div>

          {/* Per-wheel summary table */}
          <div className="overflow-x-auto border border-ink/20">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-ink/30">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Ruota</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Range medio (mm)</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Min (mm)</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Max (mm)</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">% Compr.</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">% Estens.</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Skew medio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {WHEELS.map((w) => {
                  const s = result.travel[w];
                  if (!s.available) {
                    return (
                      <TableRow key={w} className="border-b border-ink/10">
                        <TableCell className="font-mono text-xs">{WHEEL_LABEL[w]}</TableCell>
                        <TableCell colSpan={6} className="font-mono text-xs text-muted-foreground">
                          non disponibile ({s.unavailableReason ?? "—"})
                        </TableCell>
                      </TableRow>
                    );
                  }
                  const d = distData.find((x) => x.key === w);
                  return (
                    <TableRow key={w} className="border-b border-ink/10">
                      <TableCell className="font-mono text-xs">
                        <span
                          className="mr-2 inline-block h-2 w-2 align-middle"
                          style={{ background: WHEEL_COLOR[w] }}
                        />
                        {WHEEL_LABEL[w]}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{fmt(s.meanRange)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{fmt(d?.low)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{fmt(d?.high)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{fmtPct(s.meanCompressionFrac)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{fmtPct(s.meanExtensionFrac)}</TableCell>
                      <TableCell className="font-mono text-xs tabular-nums">{fmtSigned(s.meanSkew, 2)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Axle / side balance */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="border border-ink/20 p-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Bilanciamento asse (range medio)
              </div>
              <div className="mt-2 font-mono text-sm">
                Anteriore: <span className="tabular-nums">{fmt(result.balance.frontRangeMean)} mm</span>{" "}
                · Posteriore: <span className="tabular-nums">{fmt(result.balance.rearRangeMean)} mm</span>
              </div>
              <div className="mt-1 font-mono text-xs">
                Δ (Ant − Post):{" "}
                <span className="tabular-nums">{fmtSigned(result.balance.frontMinusRear)} mm</span>
                {result.balance.axlePartial && (
                  <span className="ml-2 text-[9px] uppercase tracking-widest text-race-red">parziale</span>
                )}
              </div>
            </div>
            <div className="border border-ink/20 p-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Bilanciamento lato (range medio)
              </div>
              <div className="mt-2 font-mono text-sm">
                Sinistra: <span className="tabular-nums">{fmt(result.balance.leftRangeMean)} mm</span>{" "}
                · Destra: <span className="tabular-nums">{fmt(result.balance.rightRangeMean)} mm</span>
              </div>
              <div className="mt-1 font-mono text-xs">
                Δ (Sx − Dx):{" "}
                <span className="tabular-nums">{fmtSigned(result.balance.leftMinusRight)} mm</span>
                {result.balance.sidePartial && (
                  <span className="ml-2 text-[9px] uppercase tracking-widest text-race-red">parziale</span>
                )}
              </div>
            </div>
          </div>

          {/* Per-lap range evolution */}
          {rangeChartData.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Evoluzione range di corsa per giro (mm)
              </h5>
              <div className="h-64 border border-ink/20 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rangeChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="#00000010" />
                    <XAxis dataKey="lap" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                    <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} />
                    <Tooltip
                      contentStyle={{ background: "white", border: "1px solid #00000030", fontFamily: "monospace", fontSize: 11 }}
                      labelFormatter={(l) => `Giro ${l}`}
                      formatter={(v: number, k: string) => [`${v.toFixed(1)} mm`, WHEEL_LABEL[k as WheelKey] ?? k]}
                    />
                    <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 10 }} />
                    {WHEELS.filter((w) => result.travel[w].available).map((w) => (
                      <Line
                        key={w}
                        type="monotone"
                        dataKey={w}
                        name={WHEEL_LABEL[w]}
                        stroke={WHEEL_COLOR[w]}
                        dot={false}
                        strokeWidth={1.5}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Per-wheel min/max span — proxy box-plot */}
          {distData.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Distribuzione corsa per ruota (min ↔ max sullo stint, mm)
              </h5>
              <div className="space-y-1 border border-ink/20 p-3">
                {(() => {
                  const allLo = Math.min(...distData.map((d) => d.low));
                  const allHi = Math.max(...distData.map((d) => d.high));
                  const span = allHi - allLo || 1;
                  return distData.map((d) => {
                    const leftPct = ((d.low - allLo) / span) * 100;
                    const widthPct = ((d.high - d.low) / span) * 100;
                    return (
                      <div key={d.key} className="flex items-center gap-2">
                        <span className="w-8 font-mono text-[10px]">{d.wheel}</span>
                        <div className="relative h-3 flex-1 bg-muted/60">
                          <div
                            className="absolute h-3"
                            style={{
                              left: `${leftPct}%`,
                              width: `${widthPct}%`,
                              background: WHEEL_COLOR[d.key as WheelKey],
                              opacity: 0.7,
                            }}
                          />
                        </div>
                        <span className="w-32 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
                          {fmt(d.low)} … {fmt(d.high)} mm
                        </span>
                      </div>
                    );
                  });
                })()}
                <div className="mt-2 font-mono text-[9px] text-muted-foreground">
                  Escursione complessiva osservata su tutto lo stint, per ruota.
                </div>
              </div>
            </div>
          )}

          {/* Dynamic rake (calculated) */}
          {result.dynamicRake.available && (
            <div className="space-y-2">
              <h5 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Rake dinamico calcolato (Ant − Post delle corse, mm)
              </h5>
              <p className="font-mono text-[10px] text-muted-foreground">
                <span className="font-bold text-ink">Variazione relativa</span>{" "}
                di assetto derivata dalle corse sospensione,{" "}
                <span className="font-bold">NON</span> il rake assoluto in mm o
                gradi. Il canale <code>rideheight rake</code> grezzo NON è
                usato perché non rappresentativo (range ±200 mm non fisico).
              </p>
              <div className="border border-ink/20 p-3 font-mono text-sm">
                Δ medio stint:{" "}
                <span className="tabular-nums">{fmtSigned(result.dynamicRake.meanDelta)} mm</span>{" "}
                <span className="text-[10px] text-muted-foreground">
                  · da {result.dynamicRake.frontWheels.map((w) => WHEEL_LABEL[w]).join("/")} −{" "}
                  {result.dynamicRake.rearWheels.map((w) => WHEEL_LABEL[w]).join("/")}
                </span>
              </div>
              {rakeChartData.length > 0 && (
                <div className="h-56 border border-ink/20 p-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rakeChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="#00000010" />
                      <XAxis dataKey="lap" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                      <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} />
                      <ReferenceLine y={0} stroke="#000" />
                      <Tooltip
                        contentStyle={{ background: "white", border: "1px solid #00000030", fontFamily: "monospace", fontSize: 11 }}
                        labelFormatter={(l) => `Giro ${l}`}
                        formatter={(v: number) => [`${v.toFixed(2)} mm`, "Δ (F−R)"]}
                      />
                      <Bar dataKey="delta" fill="#0ea5e9" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        <Notice>Canali di corsa sospensione non disponibili: Sezione A non rappresentabile.</Notice>
      )}

      {/* ============ SECTION B — RAW / TO VERIFY ============ */}
      {result.hasRideHeight && (
        <section className="space-y-3 border-l-2 border-race-red/70 pl-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-race-red">
              Sezione B · Grezzo / da verificare
            </div>
            <h4 className="font-display text-xl tracking-wider">Ride height (non calibrato)</h4>
          </div>
          <div className="border border-race-red/40 bg-race-red/5 p-3">
            <p className="font-mono text-[10px] leading-relaxed text-ink">
              <span className="font-bold">Dati di assetto grezzi, non calibrati:</span>{" "}
              range non fisici e zone a zero (box/fermo) presenti; mostrati solo
              come <span className="font-bold">andamento indicativo</span>, NON
              come altezza assoluta in mm. Da verificare con calibrazione prima
              di qualunque uso quantitativo. Nessun bilanciamento o delta è
              calcolato su questi canali.
            </p>
          </div>

          {rhChartData.length > 0 ? (
            <div className="h-56 border border-ink/20 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rhChartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#00000010" />
                  <XAxis dataKey="lap" tick={{ fontSize: 10, fontFamily: "monospace" }} />
                  <YAxis tick={{ fontSize: 10, fontFamily: "monospace" }} />
                  <Tooltip
                    contentStyle={{ background: "white", border: "1px solid #00000030", fontFamily: "monospace", fontSize: 11 }}
                    labelFormatter={(l) => `Giro ${l}`}
                    formatter={(v: number, k: string) => [`${v.toFixed(1)} (grezzo)`, WHEEL_LABEL[k as WheelKey] ?? k]}
                  />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 10 }} />
                  {rhWheels.map((w) => (
                    <Line
                      key={w}
                      type="monotone"
                      dataKey={w}
                      name={WHEEL_LABEL[w]}
                      stroke={WHEEL_COLOR[w]}
                      dot={false}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Notice>
              Nessun valore di ride height all'interno dell'intervallo
              plausibile dichiarato: traccia non rappresentabile.
            </Notice>
          )}

          <div className="font-mono text-[10px] text-muted-foreground">
            Filtrati come non plausibili (≤ 0 mm o &gt; 400 mm):{" "}
            {WHEELS.filter((w) => result.rideHeightAvailable[w])
              .map((w) => `${WHEEL_LABEL[w]} ${result.rideHeight.filteredOut[w]}`)
              .join(" · ")}
            {" "}campioni.
          </div>
        </section>
      )}
    </div>
  );
}
