// Weather Evolution panel — per-stint evolution of on-board environmental
// sensors (airTemp, humidity, airPressure, wet).
//
// Source: STRICTLY on-board sensors recorded during the session (PTH/wet).
// No network call, no external weather provider. When all four channels are
// missing, the section renders a neutral notice and nothing else. The
// integration with external weather data lives in a separate module that
// activates only when these on-board channels are absent.

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel } from "@/lib/ld/channelResolver";
import {
  buildWeatherEvolution,
  WET_TRANSITION_PCT,
  type LapWeatherRow,
  type SeriesDelta,
} from "@/lib/ld/weatherEvolution";
import {
  fetchOpenMeteo,
  normalizeSessionDate,
  sessionTimeToSeconds,
  type OpenMeteoSeries,
} from "@/lib/weather/openMeteo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gauge } from "@/components/telemetry/Gauge";

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

function hasAnyOnboardWeather(file: LdFile): boolean {
  return !!(
    resolveChannel(file.channels, "airTemp") ||
    resolveChannel(file.channels, "humidity") ||
    resolveChannel(file.channels, "airPressure") ||
    resolveChannel(file.channels, "wet")
  );
}

interface GpsPick {
  lat: number;
  lon: number;
  source: "gps-hi" | "gps-lo";
  sampleCount: number;
}

function isPlausibleLatLon(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 || lon === 0) return false;
  if (lat === -1 || lon === -1) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return true;
}

function medianOf(arr: number[]): number {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function gatherCoords(
  lat: Channel,
  lon: Channel,
  tStart: number,
  tEnd: number,
): { lats: number[]; lons: number[] } {
  const lats: number[] = [];
  const lons: number[] = [];
  const latFreq = lat.freq || 1;
  const lonFreq = lon.freq || 1;
  const from = Math.max(0, Math.floor(tStart * latFreq));
  const to = Math.min(lat.values.length - 1, Math.ceil(tEnd * latFreq));
  for (let i = from; i <= to; i++) {
    const la = lat.values[i];
    const t = i / latFreq;
    const j = Math.floor(t * lonFreq);
    if (j < 0 || j >= lon.values.length) continue;
    const lo = lon.values[j];
    if (!isPlausibleLatLon(la, lo)) continue;
    lats.push(la);
    lons.push(lo);
  }
  return { lats, lons };
}

function pickCircuitGps(file: LdFile, laps: LapRow[]): GpsPick | null {
  const valid = laps.filter((l) => l.isValidLap);
  const ref =
    valid.find((l) => l.isFastest) ??
    valid[0] ??
    (laps.length > 0 ? [...laps].sort((a, b) => b.tEnd - b.tStart - (a.tEnd - a.tStart))[0] : null);
  if (!ref) return null;

  const hi = {
    lat: resolveChannel(file.channels, "gpsLatHi"),
    lon: resolveChannel(file.channels, "gpsLonHi"),
  };
  const lo = {
    lat: resolveChannel(file.channels, "gpsLatLo"),
    lon: resolveChannel(file.channels, "gpsLonLo"),
  };
  const pairs: Array<{ lat: Channel; lon: Channel; source: "gps-hi" | "gps-lo" }> = [];
  if (hi.lat && hi.lon) pairs.push({ lat: hi.lat, lon: hi.lon, source: "gps-hi" });
  if (lo.lat && lo.lon) pairs.push({ lat: lo.lat, lon: lo.lon, source: "gps-lo" });
  for (const p of pairs) {
    const { lats, lons } = gatherCoords(p.lat, p.lon, ref.tStart, ref.tEnd);
    if (lats.length >= 5) {
      return {
        lat: medianOf(lats),
        lon: medianOf(lons),
        source: p.source,
        sampleCount: lats.length,
      };
    }
  }
  return null;
}

interface StintWindow {
  startSec: number;
  endSec: number;
  ambiguousTime: boolean;
}

function computeStintWindow(file: LdFile, laps: LapRow[]): StintWindow | null {
  const valid = laps.filter((l) => l.isValidLap);
  if (valid.length === 0) return null;
  const tStart = Math.min(...valid.map((l) => l.tStart));
  const tEnd = Math.max(...valid.map((l) => l.tEnd));
  const base = sessionTimeToSeconds(file.meta.time);
  const ambiguousTime = base === undefined;
  const startSec = (base ?? 0) + tStart;
  const endSec = (base ?? 0) + tEnd;
  return { startSec, endSec, ambiguousTime };
}

type FallbackPos =
  | { kind: "gps"; lat: number; lon: number; source: "gps-hi" | "gps-lo"; sampleCount: number }
  | { kind: "manual"; lat: number; lon: number };

type FallbackState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: OpenMeteoSeries; pos: FallbackPos; window: StintWindow; isoDate: string };

interface FallbackTrigger {
  pos: FallbackPos;
  isoDate: string;
  window: StintWindow;
}

function OpenMeteoFallback({ file, laps }: { file: LdFile; laps: LapRow[] }) {
  const isoDate = useMemo(() => normalizeSessionDate(file.meta.date), [file.meta.date]);
  const gps = useMemo(() => pickCircuitGps(file, laps), [file, laps]);
  const stintWindow = useMemo(() => computeStintWindow(file, laps), [file, laps]);

  const [manual, setManual] = useState<{ lat: string; lon: string }>({ lat: "", lon: "" });
  const [manualPos, setManualPos] = useState<{ lat: number; lon: number } | null>(null);
  const [state, setState] = useState<FallbackState>({ status: "idle" });
  const requestedRef = useRef<string | null>(null);

  const trigger: FallbackTrigger | null = useMemo(() => {
    if (!isoDate || !stintWindow) return null;
    if (gps) {
      return {
        pos: { kind: "gps", lat: gps.lat, lon: gps.lon, source: gps.source, sampleCount: gps.sampleCount },
        isoDate,
        window: stintWindow,
      };
    }
    if (manualPos) {
      return {
        pos: { kind: "manual", lat: manualPos.lat, lon: manualPos.lon },
        isoDate,
        window: stintWindow,
      };
    }
    return null;
  }, [gps, manualPos, isoDate, stintWindow]);

  useEffect(() => {
    if (!trigger) return;
    const key = `${trigger.pos.lat.toFixed(4)}|${trigger.pos.lon.toFixed(4)}|${trigger.isoDate}`;
    if (requestedRef.current === key) return;
    requestedRef.current = key;
    const ac = new AbortController();
    setState({ status: "loading" });
    fetchOpenMeteo({
      lat: trigger.pos.lat,
      lon: trigger.pos.lon,
      date: trigger.isoDate,
      timeWindow: { startSec: trigger.window.startSec, endSec: trigger.window.endSec },
      signal: ac.signal,
    })
      .then((r) => {
        if (ac.signal.aborted) return;
        if (r.ok) {
          setState({
            status: "ok",
            data: r.data,
            pos: trigger.pos,
            window: trigger.window,
            isoDate: trigger.isoDate,
          });
        } else {
          setState({ status: "error", message: r.error.message });
        }
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Errore imprevisto.",
        });
      });
    return () => {
      ac.abort();
    };
  }, [trigger]);

  const submitManual = () => {
    const la = Number(manual.lat.replace(",", "."));
    const lo = Number(manual.lon.replace(",", "."));
    if (!isPlausibleLatLon(la, lo)) {
      setState({ status: "error", message: "Coordinate manuali non valide." });
      return;
    }
    requestedRef.current = null; // force a new fetch
    setManualPos({ lat: la, lon: lo });
  };

  const retry = () => {
    requestedRef.current = null;
    if (manualPos) setManualPos({ ...manualPos });
    else if (gps) setState({ status: "idle" }); // trigger memo unchanged; bump by clearing
  };

  return (
    <div className="space-y-4">
      <div className="border border-race-red/40 bg-race-red/5 p-3">
        <p className="font-mono text-[11px] leading-relaxed text-ink">
          <span className="font-bold uppercase tracking-widest">Esterno · Open-Meteo</span> —
          Nessun canale meteo di bordo disponibile in questo file. Tentativo
          di recupero dati meteo esterni (fonte modellistica, non misurata
          sull'auto).
        </p>
      </div>

      {!isoDate && (
        <Notice>
          Data sessione assente o non riconosciuta in file.meta.date — impossibile interrogare Open-Meteo.
        </Notice>
      )}

      {isoDate && !gps && (
        <div className="space-y-2 border border-ink/15 p-3">
          <p className="font-mono text-[11px] text-ink">
            GPS non disponibile nel file. Inserisci manualmente le coordinate del circuito:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-40 rounded-none font-mono text-xs"
              placeholder="lat (es. 45.6156)"
              value={manual.lat}
              onChange={(e) => setManual({ ...manual, lat: e.target.value })}
            />
            <Input
              className="h-8 w-40 rounded-none font-mono text-xs"
              placeholder="lon (es. 9.2811)"
              value={manual.lon}
              onChange={(e) => setManual({ ...manual, lon: e.target.value })}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-none font-mono text-[10px] uppercase tracking-widest"
              onClick={submitManual}
            >
              Recupera meteo
            </Button>
          </div>
        </div>
      )}

      {state.status === "loading" && <Notice>Recupero meteo esterno…</Notice>}

      {state.status === "error" && (
        <div className="space-y-2">
          <Notice>Errore Open-Meteo: {state.message}</Notice>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-none font-mono text-[10px] uppercase tracking-widest"
            onClick={retry}
          >
            Riprova
          </Button>
        </div>
      )}

      {state.status === "ok" && <ExternalSeries state={state} />}

      <p className="max-w-4xl border-t border-ink/15 pt-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-bold uppercase tracking-widest text-race-red">Disclaimer rafforzato.</span>{" "}
        I dati visualizzati provengono da <span className="font-bold">Open-Meteo</span> (modello
        di previsione o rianalisi storica), <span className="font-bold">NON</span> da sensori
        misurati a bordo. Risoluzione spaziale dell'ordine del km (meteo dell'area del circuito,
        non temperatura asfalto né micro-meteo della pista). Risoluzione temporale 15 min o
        oraria, molto più grossolana della durata di uno stint. Usati solo perché i sensori
        ambientali di bordo non sono disponibili in questo file. La posizione e l'ora sono
        derivate dal file (vedi etichette sopra); quando il GPS è assente è richiesto
        l'inserimento manuale. Il giudizio resta all'ingegnere.{" "}
        <span className="font-bold">Dati meteo: Open-Meteo.com (CC BY 4.0)</span>.
      </p>
    </div>
  );
}

function ExternalSeries({
  state,
}: {
  state: Extract<FallbackState, { status: "ok" }>;
}) {
  const { data, pos, window, isoDate } = state;
  const chartData = data.times.map((t, i) => ({
    t,
    temp: data.temperature[i] ?? null,
    hum: data.humidity[i] ?? null,
    press: data.pressure[i] ?? null,
    prec: data.precipitation[i] ?? null,
    wind: data.windSpeed[i] ?? null,
  }));

  const xTick = (v: string) => v.slice(11, 16); // HH:MM

  const tooltipFor = (unit: string | undefined) => ({
    contentStyle: {
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--ink) / 0.4)",
      borderRadius: 0,
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 11,
    },
    labelFormatter: (v: string) => v.replace("T", " "),
    formatter: (value: number, name: string) => [
      `${typeof value === "number" ? value.toFixed(1) : value} ${unit ?? ""}`.trim(),
      name,
    ],
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 border border-ink/15 bg-muted/20 p-3 font-mono text-[11px] md:grid-cols-3">
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Posizione</div>
          <div className="text-ink">
            {pos.lat.toFixed(4)}, {pos.lon.toFixed(4)}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            {pos.kind === "gps"
              ? `da GPS file (${pos.source}, ${pos.sampleCount} campioni)`
              : "inserimento manuale"}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Data / finestra</div>
          <div className="text-ink">{isoDate}</div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            {window.ambiguousTime
              ? "ora sessione assente — allineamento approssimato"
              : `local ${secToHms(window.startSec)} → ${secToHms(window.endSec)}`}{" "}
            · offset UTC {(data.utcOffsetSeconds / 3600).toFixed(1)} h
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Sorgente</div>
          <div className="text-ink">
            Open-Meteo {data.source} · {data.resolution}
          </div>
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            pressione: {data.pressureIsSurface ? "surface" : "MSL"}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ExtChart
          title={`Temperatura aria (${data.units.temperature ?? "°C"}) — ESTERNO`}
          data={chartData}
          dataKey="temp"
          color="hsl(var(--race-red))"
          tooltip={tooltipFor(data.units.temperature)}
          xTick={xTick}
        />
        <ExtChart
          title={`Umidità (${data.units.humidity ?? "%"}) — ESTERNO`}
          data={chartData}
          dataKey="hum"
          color="#1e6f8a"
          tooltip={tooltipFor(data.units.humidity)}
          xTick={xTick}
        />
        <ExtChart
          title={`Pressione${data.units.pressure ? ` (${data.units.pressure})` : ""} — ESTERNO`}
          data={chartData}
          dataKey="press"
          color="#b67900"
          tooltip={tooltipFor(data.units.pressure)}
          xTick={xTick}
          yWidth={54}
        />
        <ExtChart
          title={`Precipitazione (${data.units.precipitation ?? "mm"}) — ESTERNO`}
          data={chartData}
          dataKey="prec"
          color="#2a7a3a"
          tooltip={tooltipFor(data.units.precipitation)}
          xTick={xTick}
        />
        <ExtChart
          title={`Vento (${data.units.windSpeed ?? "km/h"}) — ESTERNO`}
          data={chartData}
          dataKey="wind"
          color="#4a4a4a"
          tooltip={tooltipFor(data.units.windSpeed)}
          xTick={xTick}
        />
      </div>
    </div>
  );
}

interface ExtChartRow {
  t: string;
  temp: number | null;
  hum: number | null;
  press: number | null;
  prec: number | null;
  wind: number | null;
}

function ExtChart({
  title,
  data,
  dataKey,
  color,
  tooltip,
  xTick,
  yWidth = 42,
}: {
  title: string;
  data: ExtChartRow[];
  dataKey: keyof ExtChartRow;
  color: string;
  tooltip: ReturnType<typeof Object>;
  xTick: (v: string) => string;
  yWidth?: number;
}) {
  const hasData = data.some((d) => {
    const v = d[dataKey];
    return typeof v === "number" && Number.isFinite(v);
  });
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="border border-race-red/60 bg-race-red/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-race-red">
          esterno
        </span>
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {title}
        </h4>
      </div>
      {!hasData ? (
        <Notice>Serie non disponibile per la finestra richiesta.</Notice>
      ) : (
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 14, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="2 3" stroke="hsl(var(--ink) / 0.15)" />
              <XAxis
                dataKey="t"
                tickFormatter={xTick}
                stroke="hsl(var(--ink))"
                tick={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}
              />
              <YAxis
                stroke="hsl(var(--ink))"
                tick={{ fontFamily: "var(--font-mono, monospace)", fontSize: 10 }}
                width={yWidth}
                domain={["auto", "auto"]}
              />
              <Tooltip {...tooltip} />
              <Line
                type="monotone"
                dataKey={dataKey as string}
                stroke={color}
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 2.5 }}
                connectNulls
                isAnimationActive={false}
                name="esterno"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function secToHms(s: number): string {
  const sec = Math.max(0, Math.round(s));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function WeatherEvolutionPanel({ file, laps }: { file: LdFile; laps: LapRow[] }) {
  const result = useMemo(() => buildWeatherEvolution(file, laps), [file, laps]);

  // STRICT gate: external fallback is allowed ONLY when no on-board weather
  // channel is present at all. A single missing-laps "no-channels" result
  // with channels present must NOT trigger a network call.
  if (result.kind !== "ok") {
    if (!hasAnyOnboardWeather(file)) {
      return <OpenMeteoFallback file={file} laps={laps} />;
    }
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

      {/* Gauge — % bagnato medio sullo stint (canale wet di bordo) */}
      {hasWet && summary.wetMeanPct !== undefined && Number.isFinite(summary.wetMeanPct) && (
        <div className="flex flex-col items-center gap-2 border border-ink/15 bg-card p-3 md:flex-row md:items-center md:gap-6">
          <Gauge value={summary.wetMeanPct} label="Bagnato medio %" unit="%" digits={1} />
          <div className="max-w-md space-y-1">
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              Percentuale media dei campioni classificati come bagnati dal
              canale <span className="font-bold">wet</span> a bordo: 0% =
              asciutto per tutto lo stint, 100% = bagnato per tutto lo stint.
              Senza implicazioni di "buono" o "cattivo".
            </p>
            {summary.wetTransition && (
              <p className="font-mono text-[10px] text-race-red">
                Transizione asciutto→bagnato osservata a L{summary.wetTransition.lap}{" "}
                ({fmt(summary.wetTransition.wetPct, 0)}% campioni nel giro).
              </p>
            )}
          </div>
        </div>
      )}


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
