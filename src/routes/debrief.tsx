import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useLdLoaderContext } from "@/context/LdLoaderContext";
import {
  buildStintAnalysis,
  type LapRow,
  type LapTempCorner,
  type LapCoherence,
  type SetupChange,
  type AbsHit,
} from "@/lib/ld/stintAnalysis";
import { norm } from "@/lib/ld/sessionDebrief";
import { resolveChannel, type LogicalKey } from "@/lib/ld/channelResolver";
import type { Channel, Lap, LdFile } from "@/lib/ld/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrackMap, type TrackAbsMarker } from "@/components/telemetry/TrackMap";
import { TyreEvolutionPanel } from "@/components/telemetry/TyreEvolutionPanel";
import { BrakeManagementPanel } from "@/components/telemetry/BrakeManagementPanel";
import { EngineHealthPanel } from "@/components/telemetry/EngineHealthPanel";
import { LapComparisonPanel } from "@/components/telemetry/LapComparisonPanel";
import { BrakingSignaturePanel } from "@/components/telemetry/BrakingSignaturePanel";
import { DrivingConsistencyPanel } from "@/components/telemetry/DrivingConsistencyPanel";
import { ThermalBalancePanel } from "@/components/telemetry/ThermalBalancePanel";
import { SuspensionPanel } from "@/components/telemetry/SuspensionPanel";
import { EngineUsagePanel } from "@/components/telemetry/EngineUsagePanel";
import { WeatherEvolutionPanel } from "@/components/telemetry/WeatherEvolutionPanel";
import { ChannelMappingPanel } from "@/components/telemetry/ChannelMappingPanel";
import { GGDiagramPanel } from "@/components/telemetry/GGDiagramPanel";
import { TractionSlipPanel } from "@/components/telemetry/TractionSlipPanel";
import { HandlingBalancePanel } from "@/components/telemetry/HandlingBalancePanel";


import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  computeSlipSamples,
  deriveCornerThreshold,
} from "@/lib/ld/tractionSlip";



function lapRowToLap(r: LapRow): Lap {
  return {
    index: r.lap,
    duration: r.durationS,
    tStart: r.tStart,
    tEnd: r.tEnd,
    absoluteIndex: r.absoluteLap,
  };
}


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
/**
 * Lap time rendered at ≈ 1 s resolution (Lap-Number segmentation).
 * The only authoritative precise lap time is the .ldx fastest, shown by the Overview.
 */
function fmtLapTimeRough(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  const mm = r === 60 ? m + 1 : m;
  const ss = r === 60 ? 0 : r;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
/** Precise mm:ss.mmm — use ONLY for the .ldx oracle reference. */
function fmtLapTimePrecise(s: number | undefined): string {
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
  const toolsetChannels = toolsets[0]?.channels;


  const analysis = useMemo(
    () => (file ? buildStintAnalysis(file, toolsetMeta || []) : null),
    [file, toolsetMeta],
  );

  const [selectedLap, setSelectedLap] = useState<number | "all">("all");
  const [lapFilter, setLapFilter] = useState<"all" | "valid" | "invalid">("all");
  const [cursorDist, setCursorDist] = useState<number | null>(null);
  const [setupMark, setSetupMark] = useState<{ d: number; label: string } | null>(null);
  /** Pending setup-change focus: requested from the global timeline before the
   *  target lap drill-down has mounted; consumed by the effect below. */
  const pendingSetupRef = useRef<{ lap: number; tSec: number; label: string } | null>(null);

  // Reset cursor / marker when the active lap changes.
  useEffect(() => {
    setCursorDist(null);
    setSetupMark(null);
  }, [selectedLap]);


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

  const { conditions, laps, absHits, setupChanges, has, refLapLength, coherence } = analysis;


  const visibleLaps = laps.filter((l) =>
    lapFilter === "all" ? true : lapFilter === "valid" ? l.isValidLap : !l.isValidLap,
  );
  const selected = selectedLap === "all" ? null : laps.find((l) => l.lap === selectedLap) ?? null;
  const lapAbs = selected ? absHits.filter((h) => h.lap === selected.lap) : [];
  const lapChanges = selected ? setupChanges.filter((c) => c.lap === selected.lap) : [];

  // Distance↔time index for the selected lap (used by spatial interactions).
  const distTime = useMemo(
    () => (selected ? buildDistTimeIndex(file, selected) : null),
    [file, selected],
  );

  // Cursor sample (channel values + per-corner temps at cursorDist).
  const cursorSample = useMemo(() => {
    if (!selected || cursorDist == null || !distTime) return null;
    const t = distTime.tAt(cursorDist);
    if (t == null) return null;
    return sampleAtTime(file, t);
  }, [file, selected, cursorDist, distTime]);

  // ABS markers (for the map overlay) drawn from this lap's hits.
  const absMarkers: TrackAbsMarker[] = useMemo(
    () =>
      lapAbs
        .filter((h): h is AbsHit & { lapDistance: number } =>
          h.lapDistance !== undefined && Number.isFinite(h.lapDistance),
        )
        .map((h) => ({ d: h.lapDistance, durationS: h.durationS })),
    [lapAbs],
  );

  // Apply a pending setup-change focus once the matching lap has been
  // selected and its distance↔time index is built.
  useEffect(() => {
    const pending = pendingSetupRef.current;
    if (!pending || !selected || pending.lap !== selected.lap || !distTime) return;
    const d = distTime.dAt(pending.tSec);
    pendingSetupRef.current = null;
    if (d != null) {
      setSetupMark({ d, label: pending.label });
      setCursorDist(d);
    }
  }, [selected, distTime]);

  const focusSetupChange = (c: SetupChange) => {
    if (!selected || selected.lap !== c.lap) {
      pendingSetupRef.current = { lap: c.lap, tSec: c.tSec, label: c.channelLabel };
      setSelectedLap(c.lap);
      return;
    }
    if (!distTime) return;
    const d = distTime.dAt(c.tSec);
    if (d != null) {
      setSetupMark({ d, label: c.channelLabel });
      setCursorDist(d);
    }
  };


  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6 px-6 py-8">
      <header className="border-b border-ink/30 pb-3 font-mono">
        <div className="text-[10px] uppercase tracking-[0.3em] text-race-red">◉ Analysis</div>
        <h1 className="font-display text-3xl leading-none tracking-wider">Stint Analysis</h1>
        <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          File · {file.fileName} · {laps.length} giri
        </div>
        <CoherenceStatus coherence={coherence} />
      </header>

      <div className="grid grid-cols-12 gap-6">
        {/* ---------- Conditions ribbon ---------- */}
        <div className="col-span-12 min-w-0 xl:col-span-4">
          <PaperPanel eyebrow="Session" title="Conditions">
            <div className="grid grid-cols-2 gap-3 font-mono text-xs">
              <Cond label="Wet (log B wet)" value={conditions.wetPct === undefined ? "—" : `${fmt(conditions.wetPct, 0)} %`} highlight={!!conditions.wetPct && conditions.wetPct > 50} />
              <Cond label="Air Temp" value={conditions.airTempAvg === undefined ? "—" : `${fmt(conditions.airTempAvg, 1)} °C`} />
              <Cond label="Humidity" value={conditions.humidityAvg === undefined ? "—" : `${fmt(conditions.humidityAvg, 1)} %`} />
              <Cond label="Air Pressure" value={conditions.airPressureAvg === undefined ? "—" : `${fmt(conditions.airPressureAvg, 1)} mbar`} />
            </div>
          </PaperPanel>
        </div>

        {/* ---------- Per-lap table ---------- */}
        <div className="col-span-12 min-w-0 xl:col-span-8">
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
                    <TH align="right">Time ≈ s</TH>
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
                        {fmtLapTimeRough(r.durationS)}
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
        </div>

        {/* ---------- Tabbed analysis panels ---------- */}
        <div className="col-span-12 min-w-0">
          <Tabs defaultValue="weather" className="w-full">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-none border border-ink/30 bg-card p-1">
              <TabsTrigger value="weather" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Weather Evolution</TabsTrigger>
              <TabsTrigger value="tyres" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Tyre Evolution</TabsTrigger>
              <TabsTrigger value="brakes" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Brake Management</TabsTrigger>
              <TabsTrigger value="engine" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Engine Information</TabsTrigger>
              <TabsTrigger value="lapAnalysis" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Lap Analysis</TabsTrigger>
              <TabsTrigger value="signature" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Braking &amp; Traction</TabsTrigger>
              <TabsTrigger value="consistency" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Driving Consistency</TabsTrigger>
              <TabsTrigger value="thermal" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Thermal Balance</TabsTrigger>
              <TabsTrigger value="suspension" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Suspension &amp; Platform</TabsTrigger>
              <TabsTrigger value="gg" className="rounded-none font-mono text-[10px] uppercase tracking-widest">G-G Diagram</TabsTrigger>
              <TabsTrigger value="handling" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Handling Balance</TabsTrigger>
              <TabsTrigger value="traction" className="rounded-none font-mono text-[10px] uppercase tracking-widest">Traction Slip</TabsTrigger>


            </TabsList>

            <TabsContent value="weather" className="mt-4">
              <PaperPanel eyebrow="Conditions" title="Weather Evolution">
                <WeatherEvolutionPanel file={file} laps={laps} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="tyres" className="mt-4">
              <PaperPanel eyebrow="Management" title="Tyre Evolution">
                <TyreEvolutionPanel file={file} laps={laps} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="brakes" className="mt-4">
              <PaperPanel eyebrow="Management" title="Brake Management">
                <BrakeManagementPanel file={file} laps={laps} toolsetMeta={toolsetMeta} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="engine" className="mt-4 space-y-6">
              <PaperPanel eyebrow="Management" title="Engine Health">
                <EngineHealthPanel file={file} laps={laps} toolsetMeta={toolsetMeta} />
              </PaperPanel>
              <PaperPanel eyebrow="Engine" title="Engine Usage">
                <EngineUsagePanel file={file} laps={laps} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="lapAnalysis" className="mt-4 space-y-6">
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
                      L{selected.lap} · ≈ {fmtLapTimeRough(selected.durationS)}
                      {!selected.isValidLap && <span className="ml-2"><MiniBadge tone="ink">invalid</MiniBadge></span>}
                    </h3>

                    <div className="grid grid-cols-12 gap-5">
                      {/* Track map */}
                      <div className="col-span-12 min-w-0 xl:col-span-5">
                        <Section title="Track Map">
                          <TrackMap
                            file={file}
                            refLap={lapRowToLap(selected)}
                            cursorDist={cursorDist}
                            onCursorDistChange={setCursorDist}
                            absMarkers={absMarkers}
                            setupMark={setupMark}
                          />
                          <CursorInfoPanel cursorDist={cursorDist} sample={cursorSample} />
                        </Section>
                      </div>

                      {/* Channel traces */}
                      <div className="col-span-12 min-w-0 xl:col-span-7">
                        <Section title="Channel Traces (vs Lap Distance)">
                          <LapChannelTraces
                            file={file}
                            lap={selected}
                            laps={laps}
                            refLap={!selected.isFastest ? laps.find((l) => l.isFastest) ?? null : null}
                            cursorDist={cursorDist}
                            onCursorDistChange={setCursorDist}
                          />
                        </Section>
                      </div>


                      {/* Per-lap G-G */}
                      <div className="col-span-12 min-w-0 xl:col-span-5">
                        <Section title="G-G (questo giro)">
                          <GGDiagramPanel
                            file={file}
                            laps={[selected]}
                            mode="scatter"
                            size={280}
                            compact
                            engineOptions={{ maxScatter: 1500 }}
                            subtitle={`Lap ${selected.lap} · scatter decimato`}
                          />
                        </Section>
                      </div>


                      {/* ABS hits */}
                      {has.abs && (
                        <div className="col-span-12 min-w-0 xl:col-span-6 2xl:col-span-4">
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
                        </div>
                      )}

                      {/* Brakes */}
                      {has.brakes && (
                        <div className="col-span-12 min-w-0 sm:col-span-6 xl:col-span-3 2xl:col-span-4">
                          <Section title="Brake Disc Temps">
                            <CornerGrid corner={selected.brakes} unit="°C" />
                          </Section>
                        </div>
                      )}

                      {/* Tyres */}
                      {has.tyres && (
                        <div className="col-span-12 min-w-0 sm:col-span-6 xl:col-span-3 2xl:col-span-4">
                          <Section title="Tyre Temps (TPMS)">
                            <CornerGrid corner={selected.tyres} unit="°C" />
                          </Section>
                        </div>
                      )}

                      {/* Setup changes in lap */}
                      <div className="col-span-12 min-w-0">
                        <Section title="Setup Changes in Lap">
                          {lapChanges.length === 0 ? (
                            <p className="font-mono text-xs text-muted-foreground">Nessun cambio registrato in questo giro.</p>
                          ) : (
                            <ul className="space-y-1 font-mono text-xs">
                              {lapChanges.map((c) => {
                                const active = setupMark?.label === c.channelLabel;
                                const isTc = isTcChange(c);
                                return (
                                  <li key={c.id}>
                                    <button
                                      type="button"
                                      onClick={() => focusSetupChange(c)}
                                      className={`flex w-full flex-wrap items-center gap-x-3 border border-transparent px-2 py-1 text-left hover:border-ink/30 hover:bg-muted/40 ${active ? "border-race-red bg-race-red/5 text-race-red" : ""}`}
                                      title="Localizza sulla mappa"
                                    >
                                      <span className="text-muted-foreground">{fmtTime(c.tSec - selected.tStart)}</span>
                                      <SetupChannelBadge change={c} />
                                      <span className="font-bold">{c.channelLabel}</span>
                                      <span>{formatSetupTransition(c)}</span>
                                      <span className={`ml-auto text-[10px] uppercase tracking-widest opacity-60`}>{isTc ? "◆ tc" : "◆ map"}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </Section>
                      </div>
                    </div>
                  </div>
                )}
              </PaperPanel>

              <PaperPanel eyebrow="Performance" title="Lap Comparison">
                <LapComparisonPanel file={file} laps={laps} selectedLap={selectedLap} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="signature" className="mt-4">
              <PaperPanel eyebrow="Performance" title="Braking & Traction Signature">
                <BrakingSignaturePanel
                  file={file}
                  laps={laps}
                  absHits={absHits}
                  hasAbs={has.abs}
                />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="consistency" className="mt-4">
              <PaperPanel eyebrow="Performance" title="Driving Consistency">
                <DrivingConsistencyPanel
                  file={file}
                  laps={laps}
                  absHits={absHits}
                  hasAbs={has.abs}
                />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="thermal" className="mt-4">
              <PaperPanel eyebrow="Setup" title="Thermal Balance">
                <ThermalBalancePanel file={file} laps={laps} toolsetMeta={toolsetMeta} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="suspension" className="mt-4">
              <PaperPanel eyebrow="Chassis" title="Suspension & Platform">
                <SuspensionPanel file={file} laps={laps} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="gg" className="mt-4">
              <PaperPanel eyebrow="Dynamics" title="G-G Diagram">
                <GGDiagramPanel
                  file={file}
                  laps={laps.filter((l) => l.isValidLap)}
                  mode="density"
                  size={420}
                  subtitle="Aggregato stint · solo giri validi"
                />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="handling" className="mt-4">
              <PaperPanel eyebrow="Dynamics" title="Handling Balance (Understeer/Oversteer)">
                <HandlingBalancePanel file={file} laps={laps} />
              </PaperPanel>
            </TabsContent>

            <TabsContent value="traction" className="mt-4">
              <PaperPanel eyebrow="Traction" title="Traction Slip">
                <TractionSlipPanel file={file} laps={laps} />
              </PaperPanel>
            </TabsContent>

          </Tabs>

        </div>







        {/* ---------- ABS distribution (always-on, when no lap is selected) ---------- */}
        {has.abs && has.lapDistance && selected === null && (
          <div className="col-span-12 min-w-0 xl:col-span-6">
            <PaperPanel eyebrow="Track Map" title="ABS by Lap Distance">
              <AbsDistributionBars hits={absHits} refLapLength={refLapLength} />
            </PaperPanel>
          </div>
        )}

        {/* ---------- Full setup-change timeline ----------
            Mostra la CONFIGURAZIONE scelta dal pilota (brake bias, engine map,
            selettori TC lat/lon e modalità wet), NON gli interventi del TC:
            il canale di intervento non è loggato in questi file e lo slip
            ruota disponibile non è rappresentativo. */}
        {(has.brkbias || has.mappos || has.tc) && (
          <div className={`col-span-12 min-w-0 ${has.abs && has.lapDistance && selected === null ? "xl:col-span-6" : ""}`}>
            <PaperPanel eyebrow="Stint" title="Setup Change Timeline">
              <p className="mb-3 font-mono text-[11px] leading-snug text-muted-foreground">
                Configurazione del setup scelta dal pilota durante lo stint
                (brake bias, engine map, selettori TC laterale/longitudinale e
                modalità wet). Non sono interventi del controllo di trazione:
                il flag d'intervento non è loggato e lo slip ruota non è
                rappresentativo.
              </p>
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
                      <TH>Group</TH>
                      <TH>Channel</TH>
                      <TH>Change</TH>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {setupChanges.map((c, i) => (
                      <TableRow
                        key={c.id}
                        className={`cursor-pointer border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""} hover:bg-race-red/5`}
                        onClick={() => focusSetupChange(c)}
                        title="Localizza sulla mappa"
                      >
                        <TableCell className="font-mono text-xs tabular-nums">L{c.lap}</TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">{fmtTime(c.tSec)}</TableCell>
                        <TableCell><SetupChannelBadge change={c} /></TableCell>
                        <TableCell className="font-mono text-xs">{c.channelLabel}</TableCell>
                        <TableCell className="font-mono text-xs">{formatSetupTransition(c)}</TableCell>
                      </TableRow>
                    ))}

                  </TableBody>
                </Table>
              )}
            </PaperPanel>
          </div>
        )}

        {/* ---------- Channel mapping (diagnostics, end of page) ---------- */}
        <div className="col-span-12 min-w-0">
          <PaperPanel eyebrow="Diagnostics" title="Channel Mapping">
            <ChannelMappingPanel file={file} toolsetMeta={toolsetMeta} toolsetChannels={toolsetChannels} />
          </PaperPanel>
        </div>
      </div>
    </div>
  );
}

/* ============ small subcomponents ============ */

function isTcChange(c: SetupChange): boolean {
  return c.channel === "tcLat" || c.channel === "tcLon" || c.channel === "tcWet" || c.channel === "tc";
}

function formatSetupTransition(c: SetupChange): string {
  if (c.binaryState) {
    const toOn = Math.round(c.next) === 1;
    return toOn ? "Modalità wet attivata" : "Modalità wet disattivata";
  }
  return `${fmt(c.prev, 2)} → ${fmt(c.next, 2)}`;
}

function SetupChannelBadge({ change }: { change: SetupChange }) {
  const isTc = isTcChange(change);
  const label = isTc ? "TC" : change.channel === "brkbias" ? "BIAS" : "MAP";
  const cls = isTc
    ? "border-amber-500 bg-amber-500/15 text-amber-500"
    : change.channel === "brkbias"
      ? "border-sky-500 bg-sky-500/15 text-sky-500"
      : "border-emerald-500 bg-emerald-500/15 text-emerald-500";
  return (
    <Badge className={`rounded-none border font-mono text-[9px] uppercase tracking-widest ${cls}`}>
      {label}
    </Badge>
  );
}

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

/* ============ Lap Channel Traces (drill-down chart) ============ */

/** Local convenience: resolve by an optional logical key, with a substring
 *  fallback list of alias strings for the rare case where the resolver
 *  catalogue doesn't yet cover the channel of interest. */
function findChannel(
  file: LdFile,
  logical: LogicalKey | null,
  aliases: string[] = [],
): Channel | undefined {
  if (logical) {
    const hit = resolveChannel(file.channels, logical);
    if (hit) return hit;
  }
  const wanted = aliases.map(norm);
  for (const want of wanted) {
    const exact = file.channels.find((c) => norm(c.name) === want && !c.empty);
    if (exact) return exact;
  }
  for (const want of wanted) {
    const part = file.channels.find((c) => norm(c.name).includes(want) && !c.empty);
    if (part) return part;
  }
  return undefined;
}

/** Build (distance, value) pairs for a channel within [tStart, tEnd]; skips -1 sentinel and non-finite. */
function buildLapSeries(
  ch: Channel,
  lapCh: Channel,
  tStart: number,
  tEnd: number,
): { x: number; y: number }[] {
  const i0 = Math.max(0, Math.floor(tStart * ch.freq));
  const i1 = Math.min(ch.values.length, Math.ceil(tEnd * ch.freq));
  const out: { x: number; y: number }[] = [];
  const ldFreq = lapCh.freq;
  const ldLen = lapCh.values.length;
  for (let i = i0; i < i1; i++) {
    const v = ch.values[i];
    if (!Number.isFinite(v) || v === -1) continue;
    const t = i / ch.freq;
    const j = Math.min(ldLen - 1, Math.max(0, Math.floor(t * ldFreq)));
    const d = lapCh.values[j];
    if (!Number.isFinite(d) || d < 0) continue;
    out.push({ x: d, y: v });
  }
  return out;
}

/** Decimate by bucket, keeping the sample with max |y - bucketMean| (peak-preserving). */
function decimateSeries(
  pts: { x: number; y: number }[],
  target = 900,
): { x: number; y: number }[] {
  if (pts.length <= target) return pts;
  const buckets = target;
  const step = pts.length / buckets;
  const out: { x: number; y: number }[] = [];
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * step);
    const e = Math.min(pts.length, Math.floor((b + 1) * step));
    if (e <= s) continue;
    let bestI = s;
    let bestAbs = -Infinity;
    let sum = 0;
    for (let i = s; i < e; i++) sum += pts[i].y;
    const mean = sum / (e - s);
    for (let i = s; i < e; i++) {
      const dev = Math.abs(pts[i].y - mean);
      if (dev > bestAbs) {
        bestAbs = dev;
        bestI = i;
      }
    }
    out.push(pts[bestI]);
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

interface TraceSpec {
  key: string;
  label: string;
  unit: string;
  logical: LogicalKey;
  color: string;
  /** Show reference-lap overlay (only for speed). */
  withRef?: boolean;
  decimals?: number;
}

const TRACE_SPECS: TraceSpec[] = [
  { key: "speed", label: "Ground Speed", unit: "km/h", logical: "speed",           color: "#d40000", withRef: true, decimals: 1 },
  { key: "rpm",   label: "RPM",          unit: "rpm",  logical: "rpm",             color: "#c97a00", decimals: 0 },
  { key: "aps",   label: "Throttle",     unit: "%",    logical: "throttle",        color: "#2a7a2a", decimals: 1 },
  { key: "pbf",   label: "Brake Press F", unit: "bar", logical: "brakePressFront", color: "#1f4a8a", decimals: 1 },
  { key: "pbr",   label: "Brake Press R", unit: "bar", logical: "brakePressRear",  color: "#3d6cc4", decimals: 1 },
  { key: "steer", label: "Steering",     unit: "°",    logical: "steeringAngle",   color: "#7a3d8a", decimals: 1 },
];

function LapChannelTraces({
  file,
  lap,
  laps,
  refLap,
  cursorDist = null,
  onCursorDistChange,
}: {
  file: LdFile;
  lap: LapRow;
  laps: LapRow[];
  refLap: LapRow | null;
  cursorDist?: number | null;
  onCursorDistChange?: (d: number | null) => void;
}) {



  const lapCh = findChannel(file, "lapDistance");
  if (!lapCh) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Canale "Lap Distance" non disponibile: impossibile tracciare contro la distanza.
      </p>
    );
  }

  const traces = TRACE_SPECS.map((spec) => {
    const ch = findChannel(file, spec.logical);
    if (!ch) return { spec, data: null as null | { x: number; y: number }[], ref: null as null | { x: number; y: number }[] };
    const raw = buildLapSeries(ch, lapCh, lap.tStart, lap.tEnd);
    if (raw.length === 0) return { spec, data: null, ref: null };
    const data = decimateSeries(raw);
    let ref: { x: number; y: number }[] | null = null;
    if (spec.withRef && refLap) {
      const refRaw = buildLapSeries(ch, lapCh, refLap.tStart, refLap.tEnd);
      if (refRaw.length > 0) ref = decimateSeries(refRaw);
    }
    return { spec, data, ref };
  }).filter((t) => t.data !== null) as {
    spec: TraceSpec;
    data: { x: number; y: number }[];
    ref: { x: number; y: number }[] | null;
  }[];

  if (traces.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Nessun canale tra Ground Speed / RPM / Throttle / Brake / Steering presente nel file.
      </p>
    );
  }

  // Common X domain across all traces of this lap.
  let xMax = 0;
  for (const t of traces) {
    for (const p of t.data) if (p.x > xMax) xMax = p.x;
  }
  if (xMax <= 0) xMax = 1;

  return (
    <div className="space-y-3">
      {refLap && (
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Sovrimpressione: L{refLap.lap} (fastest, ≈ {fmtLapTimeRough(refLap.durationS)}) — linea attenuata
        </div>
      )}
      {traces.map(({ spec, data, ref }) => {
        // Merge by x for tooltip continuity isn't needed; render as two series in same chart.
        const merged: { x: number; y?: number; yRef?: number }[] = data.map((p) => ({ x: p.x, y: p.y }));
        if (ref) for (const p of ref) merged.push({ x: p.x, yRef: p.y });
        merged.sort((a, b) => a.x - b.x);
        return (
          <div key={spec.key} className="border border-ink/20 bg-card/40 p-2">
            <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-widest">
              <span className="text-foreground">{spec.label}</span>
              <span className="text-muted-foreground">{spec.unit}</span>
            </div>
            <div className="h-32 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={merged}
                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                  onMouseMove={(s: { activeLabel?: number | string }) => {
                    if (!onCursorDistChange) return;
                    const v = s?.activeLabel;
                    const n = typeof v === "number" ? v : v !== undefined ? Number(v) : NaN;
                    if (Number.isFinite(n)) onCursorDistChange(n);
                  }}
                  onMouseLeave={() => onCursorDistChange?.(null)}
                >
                  <CartesianGrid stroke="hsl(var(--ink) / 0.1)" strokeDasharray="2 2" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0, Math.ceil(xMax)]}
                    tick={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    stroke="hsl(var(--ink) / 0.3)"
                  />
                  <YAxis
                    tick={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    stroke="hsl(var(--ink) / 0.3)"
                    width={42}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--ink) / 0.3)",
                      borderRadius: 0,
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 11,
                    }}
                    labelFormatter={(v: number) => `d ${v.toFixed(0)} m`}
                    formatter={(v: number, name: string) => [
                      Number.isFinite(v) ? v.toFixed(spec.decimals ?? 1) : "—",
                      name === "yRef" ? `L${refLap?.lap ?? "?"}` : `L${lap.lap}`,
                    ]}
                  />
                  {cursorDist !== null && Number.isFinite(cursorDist) && (
                    <ReferenceLine
                      x={cursorDist}
                      stroke="hsl(var(--race-red))"
                      strokeOpacity={0.6}
                      strokeDasharray="2 2"
                      ifOverflow="hidden"
                    />
                  )}
                  {ref && (
                    <Line
                      type="monotone"
                      dataKey="yRef"
                      stroke="hsl(var(--race-red))"
                      strokeOpacity={0.35}
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="y"
                    stroke={spec.color}
                    strokeWidth={1.4}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
      <SuspensionTravelTrace
        file={file}
        lapCh={lapCh}
        lap={lap}
        xMax={xMax}
        cursorDist={cursorDist}
        onCursorDistChange={onCursorDistChange}
      />
      <TractionSlipTrace
        file={file}
        lapCh={lapCh}
        lap={lap}
        laps={laps}
        xMax={xMax}
        cursorDist={cursorDist}
        onCursorDistChange={onCursorDistChange}
      />

    </div>
  );
}

/* Suspension travel — 4 wheels overlaid on a single chart vs Lap Distance.
 * Convention dichiarata in legenda: FL=red, FR=orange (anteriori, tinte calde);
 * RL=teal, RR=blue (posteriori, tinte fredde). Ruote assenti vengono omesse;
 * se nessuna è disponibile il blocco non è renderizzato. */
const SUSP_TRACE_WHEELS: { logical: LogicalKey; label: string; color: string }[] = [
  { logical: "suspTravel.fl", label: "FL", color: "#d40000" },
  { logical: "suspTravel.fr", label: "FR", color: "#e08a00" },
  { logical: "suspTravel.rl", label: "RL", color: "#0f8a8a" },
  { logical: "suspTravel.rr", label: "RR", color: "#1f4a8a" },
];

function SuspensionTravelTrace({
  file,
  lapCh,
  lap,
  xMax,
  cursorDist,
  onCursorDistChange,
}: {
  file: LdFile;
  lapCh: Channel;
  lap: LapRow;
  xMax: number;
  cursorDist: number | null;
  onCursorDistChange?: (d: number | null) => void;
}) {
  const wheels = SUSP_TRACE_WHEELS
    .map((w) => {
      const ch = findChannel(file, w.logical);
      if (!ch) return null;
      const raw = buildLapSeries(ch, lapCh, lap.tStart, lap.tEnd);
      if (raw.length === 0) return null;
      return { ...w, data: decimateSeries(raw, 700) };
    })
    .filter((x): x is { logical: LogicalKey; label: string; color: string; data: { x: number; y: number }[] } => x !== null);

  if (wheels.length === 0) return null;

  // Merge into a single dataset keyed by x; each wheel gets its own y-field.
  type Row = Record<string, number>;
  const map = new Map<number, Row>();
  for (const w of wheels) {
    for (const p of w.data) {
      const row = map.get(p.x) ?? ({ x: p.x } as Row);
      row[w.label] = p.y;
      map.set(p.x, row);
    }
  }
  const merged: Row[] = Array.from(map.values()).sort((a, b) => a.x - b.x);

  return (
    <div className="border border-ink/20 bg-card/40 p-2">
      <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-widest">
        <span className="text-foreground">Suspension Travel · FL/FR/RL/RR</span>
        <span className="text-muted-foreground">mm</span>
      </div>
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={merged}
            margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
            onMouseMove={(s: { activeLabel?: number | string }) => {
              if (!onCursorDistChange) return;
              const v = s?.activeLabel;
              const n = typeof v === "number" ? v : v !== undefined ? Number(v) : NaN;
              if (Number.isFinite(n)) onCursorDistChange(n);
            }}
            onMouseLeave={() => onCursorDistChange?.(null)}
          >
            <CartesianGrid stroke="hsl(var(--ink) / 0.1)" strokeDasharray="2 2" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, Math.ceil(xMax)]}
              tick={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--ink) / 0.3)"
            />
            <YAxis
              tick={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--ink) / 0.3)"
              width={42}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--ink) / 0.3)",
                borderRadius: 0,
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
              }}
              labelFormatter={(v: number) => `d ${v.toFixed(0)} m`}
              formatter={(v: number, name: string) => [
                Number.isFinite(v) ? `${v.toFixed(1)} mm` : "—",
                name,
              ]}
            />
            <Legend
              wrapperStyle={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
              }}
            />
            {cursorDist !== null && Number.isFinite(cursorDist) && (
              <ReferenceLine
                x={cursorDist}
                stroke="hsl(var(--race-red))"
                strokeOpacity={0.6}
                strokeDasharray="2 2"
                ifOverflow="hidden"
              />
            )}
            {wheels.map((w) => (
              <Line
                key={w.label}
                type="monotone"
                dataKey={w.label}
                name={w.label}
                stroke={w.color}
                strokeWidth={1.4}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


/* Traction Slip (calculated) vs Lap Distance — drill-down for one lap.
 * Slip = ((v_rear - v_front) / v_front) · 100, computed via the shared
 * tractionSlip formula (single source of truth). The in-corner threshold is
 * the SAME stint-wide value used by the aggregate Traction Slip panel.
 * Anti-hallucination: slip is CALCULATED (not a raw channel, not TC
 * intervention). In curva il valore è meno affidabile per via della
 * differenza geometrica tra rotaie ant/post: i tratti in curva sono
 * evidenziati con bande tratteggiate di sfondo. Se le quattro velocità
 * ruota non sono disponibili, il grafico viene omesso (degrado neutro). */
function TractionSlipTrace({
  file,
  lapCh,
  lap,
  laps,
  xMax,
  cursorDist,
  onCursorDistChange,
}: {
  file: LdFile;
  lapCh: Channel;
  lap: LapRow;
  laps: LapRow[];
  xMax: number;
  cursorDist: number | null;
  onCursorDistChange?: (d: number | null) => void;
}) {
  const cornerThr = deriveCornerThreshold(file, laps);
  const samples = computeSlipSamples(file, lap, cornerThr);
  if (!samples || samples.length === 0) return null;

  // Map each (t, slip, inCorner) → (lapDistance, slip, inCorner).
  const ldFreq = lapCh.freq;
  const ldLen = lapCh.values.length;
  const raw: { x: number; y: number; corner: boolean }[] = [];
  for (const s of samples) {
    const j = Math.min(ldLen - 1, Math.max(0, Math.floor(s.t * ldFreq)));
    const d = lapCh.values[j];
    if (!Number.isFinite(d) || d < 0) continue;
    raw.push({ x: d, y: s.slip, corner: s.inCorner });
  }
  if (raw.length === 0) return null;

  // Peak-preserving decimation (~700 points) consistent with the other
  // traces. We carry the worst-case corner flag through the bucket so that
  // the highlight is conservative (any in-corner sample taints the bucket).
  const target = 700;
  const data: { x: number; y: number; corner: boolean }[] = [];
  if (raw.length <= target) {
    data.push(...raw);
  } else {
    const buckets = target;
    const step = raw.length / buckets;
    for (let b = 0; b < buckets; b++) {
      const s0 = Math.floor(b * step);
      const s1 = Math.min(raw.length, Math.floor((b + 1) * step));
      if (s1 <= s0) continue;
      let sum = 0;
      let anyCorner = false;
      for (let i = s0; i < s1; i++) {
        sum += raw[i].y;
        if (raw[i].corner) anyCorner = true;
      }
      const mean = sum / (s1 - s0);
      let bestI = s0, bestAbs = -Infinity;
      for (let i = s0; i < s1; i++) {
        const dev = Math.abs(raw[i].y - mean);
        if (dev > bestAbs) { bestAbs = dev; bestI = i; }
      }
      data.push({ x: raw[bestI].x, y: raw[bestI].y, corner: anyCorner });
    }
  }
  data.sort((a, b) => a.x - b.x);

  // Collapse consecutive in-corner buckets into contiguous shaded intervals
  // (drawn as ReferenceArea bands) to flag less-reliable stretches.
  const cornerBands: { x1: number; x2: number }[] = [];
  let bandStart: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (data[i].corner) {
      if (bandStart === null) bandStart = data[i].x;
    } else if (bandStart !== null) {
      cornerBands.push({ x1: bandStart, x2: data[i].x });
      bandStart = null;
    }
  }
  if (bandStart !== null) cornerBands.push({ x1: bandStart, x2: data[data.length - 1].x });

  return (
    <div className="border border-ink/20 bg-card/40 p-2">
      <div className="mb-1 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-widest">
        <span className="text-foreground">Traction Slip · calcolato</span>
        <span className="text-muted-foreground">%</span>
      </div>
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
            onMouseMove={(s: { activeLabel?: number | string }) => {
              if (!onCursorDistChange) return;
              const v = s?.activeLabel;
              const n = typeof v === "number" ? v : v !== undefined ? Number(v) : NaN;
              if (Number.isFinite(n)) onCursorDistChange(n);
            }}
            onMouseLeave={() => onCursorDistChange?.(null)}
          >
            <CartesianGrid stroke="hsl(var(--ink) / 0.1)" strokeDasharray="2 2" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, Math.ceil(xMax)]}
              tick={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--ink) / 0.3)"
            />
            <YAxis
              tick={{ fontFamily: "ui-monospace, monospace", fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              stroke="hsl(var(--ink) / 0.3)"
              width={42}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--card))",
                border: "1px solid hsl(var(--ink) / 0.3)",
                borderRadius: 0,
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
              }}
              labelFormatter={(v: number) => `d ${v.toFixed(0)} m`}
              formatter={(v: number, _name: string, p: { payload?: { corner?: boolean } }) => [
                `${Number.isFinite(v) ? v.toFixed(2) : "—"} %${p?.payload?.corner ? " · in curva (meno affidabile)" : ""}`,
                "slip",
              ]}
            />
            {cornerBands.map((b, i) => (
              <ReferenceArea
                key={i}
                x1={b.x1}
                x2={b.x2}
                fill="hsl(var(--ink) / 0.08)"
                stroke="hsl(var(--ink) / 0.25)"
                strokeDasharray="2 3"
                ifOverflow="hidden"
              />
            ))}
            {cursorDist !== null && Number.isFinite(cursorDist) && (
              <ReferenceLine
                x={cursorDist}
                stroke="hsl(var(--race-red))"
                strokeOpacity={0.6}
                strokeDasharray="2 2"
                ifOverflow="hidden"
              />
            )}
            <ReferenceLine y={0} stroke="hsl(var(--ink) / 0.4)" />
            <Line
              type="monotone"
              dataKey="y"
              stroke="#7a3d8a"
              strokeWidth={1.4}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
        Slip <b>calcolato</b> dalle velocità ruota
        ((v<sub>post</sub>−v<sub>ant</sub>)/v<sub>ant</sub>·100). Bande
        tratteggiate = tratti in curva, meno affidabili (contaminazione
        geometrica). Non è l'intervento del Traction Control.
      </p>
    </div>
  );
}





/* ============ Coherence status banner ============ */

function CoherenceStatus({ coherence }: { coherence: LapCoherence }) {
  const {
    totalSegments,
    validLaps,
    fastestLapSession,
    oracleFastestLap,
    oracleFastestSec,
    oracleTotalLaps,
    alignedWithOracle,
  } = coherence;

  const oracleStr =
    oracleFastestSec !== undefined && oracleFastestLap !== undefined
      ? `ldx: fastest L${oracleFastestLap} ${fmtLapTimePrecise(oracleFastestSec)}${oracleTotalLaps !== undefined ? `, ${oracleTotalLaps} giri` : ""}`
      : "ldx non disponibile";

  const segStr =
    `Segmentazione Lap Number: ${totalSegments} segmenti, ${validLaps} validi` +
    (fastestLapSession !== undefined ? `, riferimento L${fastestLapSession}` : "");

  const alignedStr =
    oracleFastestLap !== undefined
      ? alignedWithOracle
        ? "allineato con ldx"
        : "non allineato con ldx"
      : "";

  const tone: "ok" | "warn" = alignedWithOracle ? "ok" : "warn";
  const cls =
    tone === "ok"
      ? "border-race-red text-race-red"
      : "border-ink/40 text-muted-foreground";

  return (
    <div className="mt-2 space-y-1">
      <div className={`inline-block border px-2 py-1 text-[10px] uppercase tracking-widest ${cls}`}>
        {segStr}
        {alignedStr ? ` · ${alignedStr}` : ""}
        {` · ${oracleStr}`}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Tempi per-giro qui sotto ≈ 1 s (da Lap Number). Il tempo preciso ufficiale è quello dell'Overview (.ldx).
      </div>
    </div>
  );
}

/* ============ Spatial helpers (distance↔time + per-cursor sample) ============ */

interface DistTimeIndex {
  /** Time (s) for a given lap distance (m). null if out of range. */
  tAt(d: number): number | null;
  /** Lap distance (m) for a given absolute time (s). null if outside the lap. */
  dAt(t: number): number | null;
}

/** Build a monotonic distance↔time index from the Lap Distance channel over a lap window. */
function buildDistTimeIndex(file: LdFile, lap: LapRow): DistTimeIndex | null {
  const lapCh = findChannel(file, "lapDistance");
  if (!lapCh) return null;
  const freq = lapCh.freq || 1;
  const i0 = Math.max(0, Math.floor(lap.tStart * freq));
  const i1 = Math.min(lapCh.values.length, Math.ceil(lap.tEnd * freq));
  const samples: { t: number; d: number }[] = [];
  for (let i = i0; i < i1; i++) {
    const d = lapCh.values[i];
    if (!Number.isFinite(d) || d < 0) continue;
    samples.push({ t: i / freq, d });
  }
  if (samples.length < 4) return null;
  const byTime = samples.slice().sort((a, b) => a.t - b.t);
  const byDist = samples.slice().sort((a, b) => a.d - b.d);
  const lerp = (
    arr: { t: number; d: number }[],
    key: "t" | "d",
    target: number,
    other: "t" | "d",
  ): number | null => {
    if (arr.length === 0) return null;
    if (target <= arr[0][key]) return arr[0][other];
    if (target >= arr[arr.length - 1][key]) return arr[arr.length - 1][other];
    let lo = 0;
    let hi = arr.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid][key] <= target) lo = mid;
      else hi = mid;
    }
    const a = arr[lo];
    const b = arr[hi];
    const span = b[key] - a[key];
    const tt = span > 0 ? (target - a[key]) / span : 0;
    return a[other] + (b[other] - a[other]) * tt;
  };
  return {
    tAt: (d: number) => (Number.isFinite(d) ? lerp(byDist, "d", d, "t") : null),
    dAt: (t: number) => (Number.isFinite(t) ? lerp(byTime, "t", t, "d") : null),
  };
}

interface CursorSample {
  /** Generic channel readouts (speed/throttle/brake/rpm/steer) at the cursor. */
  channels: { label: string; unit: string; value: number; decimals: number }[];
  brakes: { fl?: number; fr?: number; rl?: number; rr?: number };
  tyres: { fl?: number; fr?: number; rl?: number; rr?: number };
}

function sampleChan(ch: Channel | undefined, t: number): number | undefined {
  if (!ch) return undefined;
  const freq = ch.freq || 1;
  const i = Math.max(0, Math.min(ch.values.length - 1, Math.round(t * freq)));
  const v = ch.values[i];
  if (!Number.isFinite(v) || v === -1) return undefined;
  return v;
}

function sampleAtTime(file: LdFile, t: number): CursorSample {
  const grab = (k: LogicalKey) => sampleChan(findChannel(file, k), t);
  const speed = grab("speed");
  const rpm = grab("rpm");
  const aps = grab("throttle");
  const pbf = grab("brakePressFront");
  const pbr = grab("brakePressRear");
  const steer = grab("steeringAngle");

  const channels: CursorSample["channels"] = [];
  const push = (label: string, unit: string, v: number | undefined, decimals = 1) => {
    if (v !== undefined && Number.isFinite(v)) channels.push({ label, unit, value: v, decimals });
  };
  push("v", "km/h", speed, 1);
  push("RPM", "", rpm, 0);
  push("Throttle", "%", aps, 1);
  push("Brake F", "bar", pbf, 1);
  push("Brake R", "bar", pbr, 1);
  push("Steer", "°", steer, 1);

  const corner = (base: "brakeDiscTemp" | "tyreTemp") => ({
    fl: sampleChan(findChannel(file, `${base}.fl` as LogicalKey), t),
    fr: sampleChan(findChannel(file, `${base}.fr` as LogicalKey), t),
    rl: sampleChan(findChannel(file, `${base}.rl` as LogicalKey), t),
    rr: sampleChan(findChannel(file, `${base}.rr` as LogicalKey), t),
  });
  return {
    channels,
    brakes: corner("brakeDiscTemp"),
    tyres: corner("tyreTemp"),
  };
}

/* ============ Cursor info panel ============ */

function CursorInfoPanel({
  cursorDist,
  sample,
}: {
  cursorDist: number | null;
  sample: CursorSample | null;
}) {
  if (cursorDist == null || !sample) {
    return (
      <p className="mt-2 font-mono text-[11px] text-muted-foreground">
        Passa il mouse su mappa o tracce per leggere i valori puntuali del giro.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2 border border-ink/20 bg-card/40 p-3 font-mono">
      <div className="flex flex-wrap items-baseline gap-x-3 text-[10px] uppercase tracking-widest">
        <span className="text-race-red">cursore</span>
        <span className="tabular-nums text-foreground">{Math.round(cursorDist)} m</span>
      </div>
      {sample.channels.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {sample.channels.map((c) => (
            <span key={c.label} className="tabular-nums">
              <span className="text-muted-foreground">{c.label}</span>{" "}
              <b>{c.value.toFixed(c.decimals)}</b>
              {c.unit && <span className="text-muted-foreground"> {c.unit}</span>}
            </span>
          ))}
        </div>
      )}
      <CornerReadout label="Brakes (°C)" c={sample.brakes} />
      <CornerReadout label="Tyres (°C)" c={sample.tyres} />
    </div>
  );
}

function CornerReadout({
  label,
  c,
}: {
  label: string;
  c: { fl?: number; fr?: number; rl?: number; rr?: number };
}) {
  const has = c.fl !== undefined || c.fr !== undefined || c.rl !== undefined || c.rr !== undefined;
  if (!has) return null;
  const cell = (v: number | undefined) =>
    v === undefined ? <span className="text-muted-foreground">—</span> : <b>{v.toFixed(0)}</b>;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 text-[11px]">
      <span className="self-center text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="grid grid-cols-4 gap-x-2 tabular-nums">
        <span>FL {cell(c.fl)}</span>
        <span>FR {cell(c.fr)}</span>
        <span>RL {cell(c.rl)}</span>
        <span>RR {cell(c.rr)}</span>
      </div>
    </div>
  );
}



