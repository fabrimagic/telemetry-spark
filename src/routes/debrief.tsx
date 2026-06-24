import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useLdLoaderContext } from "@/context/LdLoaderContext";
import { buildStintAnalysis, type LapRow, type LapTempCorner } from "@/lib/ld/stintAnalysis";
import { norm } from "@/lib/ld/sessionDebrief";
import type { Channel, LdFile } from "@/lib/ld/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/debrief")({
  head: () => ({
    meta: [
      { title: "Stint Analysis — MoTeC Pit-Wall Analyzer" },
      {
        name: "description",
        content: "Per-lap stint analysis on loaded MoTeC telemetry: lap table, ABS hits, brakes/tyres asymmetry, setup changes.",
      },
    ],
  }),
  component: DebriefPage,
  ssr: false,
});

/* ============ small format helpers ============ */
function fmt(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(d);
}
function fmtTime(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(2).padStart(5, "0")}`;
}
function fmtLapTime(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, "0")}`;
}

/* ============ inline panel + page ============ */
function PaperPanel({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: { k: string; v: string }[];
  children: ReactNode;
}) {
  return (
    <section className="paper-card">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/30 px-5 py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
            ◉ {eyebrow}
          </div>
          <h2 className="font-display text-3xl leading-none tracking-wider">{title}</h2>
        </div>
        {meta && (
          <div className="flex flex-wrap gap-2">
            {meta.map((m) => (
              <Badge
                key={m.k}
                variant="outline"
                className="rounded-none border-ink font-mono text-[10px] uppercase tracking-widest"
              >
                {m.k} · {m.v}
              </Badge>
            ))}
          </div>
        )}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function DebriefPage() {
  const { files, toolsets } = useLdLoaderContext();
  const file = files[0];
  const toolsetMeta = toolsets[0]?.displayMeta;

  const analysis = useMemo(
    () => (file ? buildStintAnalysis(file, toolsetMeta || []) : null),
    [file, toolsetMeta],
  );

  const [selectedLap, setSelectedLap] = useState<number | "all">("all");
  const [lapFilter, setLapFilter] = useState<"all" | "valid" | "invalid">("all");

  if (!file || !analysis) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-8 font-mono">
        <header className="border-b border-ink/30 pb-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
            ◉ Analysis
          </div>
          <h1 className="font-display text-3xl leading-none tracking-wider">Stint Analysis</h1>
        </header>
        <div className="paper-card p-6 text-sm text-muted-foreground">
          Nessun file caricato. Vai su{" "}
          <Link to="/" className="text-race-red underline-offset-4 hover:underline">
            Overview
          </Link>{" "}
          per caricare i dati .ld / .ldx / .toolset.
        </div>
      </div>
    );
  }

  const { conditions, laps, absHits, setupChanges, has, refLapLength } = analysis;

  const visibleLaps = laps.filter((l) =>
    lapFilter === "all" ? true : lapFilter === "valid" ? l.isValidLap : !l.isValidLap,
  );
  const selected = selectedLap === "all" ? null : laps.find((l) => l.lap === selectedLap) ?? null;
  const lapAbs = selected ? absHits.filter((h) => h.lap === selected.lap) : [];
  const lapChanges = selected ? setupChanges.filter((c) => c.lap === selected.lap) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="border-b border-ink/30 pb-3 font-mono">
        <div className="text-[10px] uppercase tracking-[0.3em] text-race-red">◉ Analysis</div>
        <h1 className="font-display text-3xl leading-none tracking-wider">Stint Analysis</h1>
        <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          File · {file.fileName} · {laps.length} giri
        </div>
      </header>

      {/* ---------- Conditions ribbon ---------- */}
      <PaperPanel eyebrow="Session" title="Conditions">
        <div className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
          <Cond label="Wet (log B wet)" value={conditions.wetPct === undefined ? "—" : `${fmt(conditions.wetPct, 0)} %`} highlight={!!conditions.wetPct && conditions.wetPct > 50} />
          <Cond label="Air Temp" value={conditions.airTempAvg === undefined ? "—" : `${fmt(conditions.airTempAvg, 1)} °C`} />
          <Cond label="Humidity" value={conditions.humidityAvg === undefined ? "—" : `${fmt(conditions.humidityAvg, 1)} %`} />
          <Cond label="Air Pressure" value={conditions.airPressureAvg === undefined ? "—" : `${fmt(conditions.airPressureAvg, 1)} mbar`} />
        </div>
      </PaperPanel>

      {/* ---------- Per-lap table ---------- */}
      <PaperPanel eyebrow="Per Lap" title="Lap Table">
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-ink/10 pb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Mostra:
          </span>
          {(["all", "valid", "invalid"] as const).map((opt) => (
            <Button
              key={opt}
              size="sm"
              variant={lapFilter === opt ? "default" : "outline"}
              onClick={() => setLapFilter(opt)}
              className="h-7 rounded-none font-mono text-[10px] uppercase tracking-widest"
            >
              {opt === "all" ? "tutti" : opt === "valid" ? "solo validi" : "solo non validi"}
            </Button>
          ))}
          <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {visibleLaps.length}/{laps.length}
          </span>
        </div>
        <div className="max-h-[520px] overflow-y-auto border border-ink/20">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--ink)/0.3)]">
              <TableRow className="border-b border-ink/30">
                <TH>Lap</TH>
                <TH align="right">Time</TH>
                {has.speed && <TH align="right">v max (km/h)</TH>}
                {has.rpm && <TH align="right">RPM max</TH>}
                {has.abs && <TH align="right">ABS</TH>}
                <TH>Flags</TH>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLaps.map((r, i) => (
                <TableRow
                  key={r.lap}
                  className={`cursor-pointer border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""} ${r.isFastest ? "border-l-2 border-l-race-red" : ""} ${selectedLap === r.lap ? "bg-race-red/5" : ""} ${!r.isValidLap ? "opacity-60" : ""}`}
                  onClick={() => setSelectedLap(selectedLap === r.lap ? "all" : r.lap)}
                  title={r.isValidLap ? undefined : "Giro non valido (frammento / out-in lap) — comunque ispezionabile"}
                >
                  <TableCell className={`font-mono text-xs tabular-nums ${r.isFastest ? "text-race-red font-bold" : ""}`}>
                    L{r.lap}
                  </TableCell>
                  <TableCell className={`text-right font-mono text-xs tabular-nums ${r.isFastest ? "text-race-red font-bold" : ""}`}>
                    {fmtLapTime(r.durationS)}
                  </TableCell>
                  {has.speed && (
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.maxSpeed, 1)}</TableCell>
                  )}
                  {has.rpm && (
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(r.maxRpm, 0)}</TableCell>
                  )}
                  {has.abs && (
                    <TableCell className="text-right font-mono text-xs tabular-nums">{r.absCount}</TableCell>
                  )}
                  <TableCell className="space-x-1">
                    {r.isFastest && <MiniBadge tone="red">fastest</MiniBadge>}
                    {!r.isValidLap && <MiniBadge tone="ink">invalid</MiniBadge>}
                    {r.isOutLap && <MiniBadge tone="ink">out-lap</MiniBadge>}
                    {r.hasAbs && <MiniBadge tone="ink">abs</MiniBadge>}
                    {r.hasAlarm && <MiniBadge tone="red">alarm</MiniBadge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PaperPanel>

      {/* ---------- Lap selector ---------- */}
      <PaperPanel eyebrow="Drill-down" title="Lap Detail">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-ink/10 pb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Giro:
          </span>
          <Button
            size="sm"
            variant={selectedLap === "all" ? "default" : "outline"}
            onClick={() => setSelectedLap("all")}
            className="h-7 rounded-none font-mono text-[10px] uppercase tracking-widest"
          >
            tutti
          </Button>
          {laps.map((r) => (
            <Button
              key={r.lap}
              size="sm"
              variant={selectedLap === r.lap ? "default" : "outline"}
              onClick={() => setSelectedLap(r.lap)}
              title={r.isValidLap ? undefined : "Giro non valido — ispezionabile"}
              className={`h-7 rounded-none font-mono text-[10px] uppercase tracking-widest ${r.isFastest ? "border-race-red text-race-red" : ""} ${!r.isValidLap ? "opacity-60 italic" : ""}`}
            >
              L{r.lap}
            </Button>
          ))}
        </div>

        {selected === null ? (
          <>
            {has.abs && has.lapDistance && (
              <AbsDistributionBars hits={absHits} refLapLength={refLapLength} />
            )}
            <p className="mt-4 font-mono text-[11px] text-muted-foreground">
              Seleziona un giro per il dettaglio.
            </p>
          </>
        ) : (
          <div className="space-y-5">
            <h3 className="font-mono text-sm font-bold tracking-widest">
              L{selected.lap} · {fmtLapTime(selected.durationS)}
              {!selected.isValidLap && <span className="ml-2"><MiniBadge tone="ink">invalid</MiniBadge></span>}
            </h3>

            {/* Channel traces vs lap distance */}
            <Section title="Channel Traces (vs Lap Distance)">
              <LapChannelTraces
                file={file}
                lap={selected}
                refLap={!selected.isFastest ? laps.find((l) => l.isFastest) ?? null : null}
              />
            </Section>

            {/* ABS hits */}
            {has.abs && (
              <Section title="ABS Activations">
                {lapAbs.length === 0 ? (
                  <p className="font-mono text-xs text-muted-foreground">Nessuna attivazione ABS.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-ink/20">
                        <TH>#</TH>
                        <TH align="right">t (mm:ss)</TH>
                        {has.lapDistance && <TH align="right">Lap Dist (m)</TH>}
                        <TH align="right">Dur (s)</TH>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lapAbs.map((h, i) => (
                        <TableRow key={i} className="border-b border-ink/10">
                          <TableCell className="font-mono text-xs tabular-nums">{i + 1}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">{fmtTime(h.tSec - selected.tStart)}</TableCell>
                          {has.lapDistance && (
                            <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(h.lapDistance, 0)}</TableCell>
                          )}
                          <TableCell className="text-right font-mono text-xs tabular-nums">{h.durationS.toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Section>
            )}

            {/* Brakes */}
            {has.brakes && (
              <Section title="Brake Disc Temps">
                <CornerGrid corner={selected.brakes} unit="°C" />
              </Section>
            )}

            {/* Tyres */}
            {has.tyres && (
              <Section title="Tyre Temps (TPMS)">
                <CornerGrid corner={selected.tyres} unit="°C" />
              </Section>
            )}

            {/* Setup changes in lap */}
            <Section title="Setup Changes in Lap">
              {lapChanges.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">Nessun cambio registrato in questo giro.</p>
              ) : (
                <ul className="space-y-1 font-mono text-xs">
                  {lapChanges.map((c) => (
                    <li key={c.id} className="flex flex-wrap gap-x-3">
                      <span className="text-muted-foreground">{fmtTime(c.tSec - selected.tStart)}</span>
                      <span className="font-bold">{c.channelLabel}</span>
                      <span>{fmt(c.prev, 2)} → {fmt(c.next, 2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </PaperPanel>

      {/* ---------- ABS distribution (always-on) ---------- */}
      {has.abs && has.lapDistance && selected === null && (
        <PaperPanel eyebrow="Track Map" title="ABS by Lap Distance">
          <AbsDistributionBars hits={absHits} refLapLength={refLapLength} />
        </PaperPanel>
      )}

      {/* ---------- Full setup-change timeline ---------- */}
      {(has.brkbias || has.mappos || has.tc) && (
        <PaperPanel eyebrow="Stint" title="Setup Change Timeline">
          {setupChanges.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              Nessun cambio assetto rilevato nello stint.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-ink/30">
                  <TH>Lap</TH>
                  <TH>t</TH>
                  <TH>Channel</TH>
                  <TH align="right">Prev</TH>
                  <TH align="right">New</TH>
                </TableRow>
              </TableHeader>
              <TableBody>
                {setupChanges.map((c, i) => (
                  <TableRow key={c.id} className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""}`}>
                    <TableCell className="font-mono text-xs tabular-nums">L{c.lap}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{fmtTime(c.tSec)}</TableCell>
                    <TableCell className="font-mono text-xs">{c.channelLabel}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(c.prev, 2)}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(c.next, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PaperPanel>
      )}
    </div>
  );
}

/* ============ small subcomponents ============ */
function TH({ children, align }: { children: ReactNode; align?: "right" }) {
  return (
    <TableHead
      className={`font-mono text-[10px] uppercase tracking-widest text-foreground ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </TableHead>
  );
}

function MiniBadge({ children, tone }: { children: ReactNode; tone: "red" | "ink" }) {
  const cls =
    tone === "red"
      ? "border border-race-red bg-race-red/15 text-race-red"
      : "border border-ink/40 bg-transparent text-ink";
  return (
    <Badge className={`rounded-none font-mono text-[9px] uppercase tracking-widest ${cls}`}>
      {children}
    </Badge>
  );
}

function Cond({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border border-ink/30 px-3 py-2 ${highlight ? "border-race-red bg-race-red/5" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-bold tabular-nums ${highlight ? "text-race-red" : ""}`}>{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-race-red">
        {title}
      </h4>
      {children}
    </div>
  );
}

function CornerGrid({ corner, unit }: { corner: LapTempCorner; unit: string }) {
  const cell = (k: "fl" | "fr" | "rl" | "rr") => {
    const c = corner[k];
    if (!c) return <span className="text-muted-foreground">—</span>;
    return (
      <span className="font-mono text-xs tabular-nums">
        max <b>{fmt(c.max, 0)}</b>
        <span className="text-muted-foreground"> / avg {fmt(c.avg, 0)}</span>
      </span>
    );
  };
  return (
    <div className="space-y-3 font-mono">
      <div className="grid grid-cols-2 gap-2">
        <Quad label="FL" unit={unit}>{cell("fl")}</Quad>
        <Quad label="FR" unit={unit}>{cell("fr")}</Quad>
        <Quad label="RL" unit={unit}>{cell("rl")}</Quad>
        <Quad label="RR" unit={unit}>{cell("rr")}</Quad>
      </div>
      <div className="flex flex-wrap gap-3 text-[11px]">
        {corner.axleDelta !== undefined && (
          <span>
            <span className="text-muted-foreground uppercase tracking-widest">Front−Rear:</span>{" "}
            <b className="tabular-nums">{(corner.axleDelta >= 0 ? "+" : "") + fmt(corner.axleDelta, 1)} {unit}</b>
          </span>
        )}
        {corner.sideDelta !== undefined && (
          <span>
            <span className="text-muted-foreground uppercase tracking-widest">Left−Right:</span>{" "}
            <b className="tabular-nums">{(corner.sideDelta >= 0 ? "+" : "") + fmt(corner.sideDelta, 1)} {unit}</b>
          </span>
        )}
        {corner.maxAll !== undefined && (
          <span>
            <span className="text-muted-foreground uppercase tracking-widest">Peak:</span>{" "}
            <b className="tabular-nums">{fmt(corner.maxAll, 0)} {unit}</b>
          </span>
        )}
      </div>
    </div>
  );
}

function Quad({ label, unit, children }: { label: string; unit: string; children: ReactNode }) {
  return (
    <div className="border border-ink/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label} <span className="opacity-60">({unit})</span>
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/* Histogram of ABS hits projected onto a single normalised lap (0..refLapLength). */
function AbsDistributionBars({
  hits,
  refLapLength,
}: {
  hits: { lapDistanceNorm?: number; inValidLap?: boolean }[];
  refLapLength?: number;
}) {
  if (!refLapLength || refLapLength <= 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Lunghezza di riferimento del giro non disponibile (nessun giro valido con Lap Distance).
      </p>
    );
  }
  const withDist = hits.filter(
    (h): h is { lapDistanceNorm: number; inValidLap: boolean } =>
      h.inValidLap === true &&
      h.lapDistanceNorm !== undefined &&
      Number.isFinite(h.lapDistanceNorm),
  );
  if (withDist.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Nessuna attivazione ABS nei giri validi con Lap Distance disponibile.
      </p>
    );
  }
  const BINS = 20;
  const bin = new Array(BINS).fill(0) as number[];
  for (const h of withDist) {
    const idx = Math.min(BINS - 1, Math.floor((h.lapDistanceNorm / refLapLength) * BINS));
    bin[idx]++;
  }
  const peak = Math.max(...bin, 1);
  return (
    <div className="space-y-2 font-mono">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Distribuzione ABS · giro normalizzato · lungh. rif. {fmt(refLapLength, 0)} m · {withDist.length} eventi
      </div>
      <div className="flex h-24 items-end gap-1 border-b border-ink/30">
        {bin.map((v, i) => (
          <div key={i} className="flex-1 bg-race-red/70" style={{ height: `${(v / peak) * 100}%` }} title={`${v} eventi`} />
        ))}
      </div>
      <div className="flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>0 m</span>
        <span>{fmt(refLapLength, 0)} m</span>
      </div>
    </div>
  );
}
