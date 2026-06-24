import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLdLoader } from "@/hooks/useLdLoader";
import { FileDropzone } from "@/components/telemetry/FileDropzone";
import { ChannelTable } from "@/components/telemetry/ChannelTable";
import { ToolsetSummary } from "@/components/telemetry/ToolsetSummary";
import { Badge } from "@/components/ui/badge";
import { exportSummaryPdf } from "@/lib/export/exportPdf";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MoTeC Pit-Wall Analyzer" },
      {
        name: "description",
        content:
          "Pit-wall telemetry analyzer per file MoTeC .ld/.ldx e configurazioni .toolset — parsing 100% client-side.",
      },
      { property: "og:title", content: "MoTeC Pit-Wall Analyzer" },
      {
        property: "og:description",
        content:
          "Riepilogo dati di telemetria e configurazione vettura, parsing 100% client-side.",
      },
    ],
  }),
  component: Index,
  ssr: false,
});

/* ---------------------------- helpers --------------------------- */

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("it-IT", { hour12: false });
}

/* ---------------------------- component ------------------------- */

function Index() {
  const loader = useLdLoader();
  const primary = loader.files[0];
  const hasAnything = loader.files.length > 0 || loader.toolsets.length > 0;
  const clock = useClock();

  const totalChannels = loader.files.reduce((a, f) => a + f.channels.length, 0);
  const totalLaps = loader.files.reduce((a, f) => a + f.laps.length, 0);

  const sections = useMemo(() => {
    const list: { id: string; label: string; kind: "ld" | "ts" | "session" }[] = [];
    if (hasAnything) list.push({ id: "session", label: "Session", kind: "session" });
    loader.files.forEach((f, i) =>
      list.push({ id: `ld-${i}`, label: f.fileName, kind: "ld" }),
    );
    loader.toolsets.forEach((t, i) =>
      list.push({ id: `ts-${i}`, label: t.fileName, kind: "ts" }),
    );
    return list;
  }, [loader.files, loader.toolsets, hasAnything]);

  return (
    <div className="flex min-h-screen flex-col">
      <PitWallHeader
        clock={clock}
        status={loader.loading ? "PARSING" : hasAnything ? "ARMED" : "IDLE"}
        files={loader.files.length}
        toolsets={loader.toolsets.length}
        onReset={loader.reset}
        hasAnything={hasAnything}
        onExportPdf={() => exportSummaryPdf(loader.files, loader.toolsets)}
      />

      <div className="flex flex-1">
        <Sidebar
          sections={sections}
          loading={loader.loading}
          totalChannels={totalChannels}
          totalLaps={totalLaps}
          onAddFiles={loader.loadFiles}
        />

        <main className="flex-1 px-6 py-8">
          {!hasAnything ? (
            <EmptyState>
              <FileDropzone
                loading={loader.loading}
                progress={loader.progress}
                stage={loader.stage}
                error={loader.error}
                onFiles={loader.loadFiles}
              />
            </EmptyState>
          ) : (
            <div className="mx-auto max-w-6xl space-y-8">
              {loader.error && (
                <div className="paper-card border-race-red bg-race-red/5 p-3 text-sm">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-race-red">
                    ⚑ Red flag
                  </span>{" "}
                  {loader.error}
                </div>
              )}

              <SessionRibbon
                car={primary?.meta.car}
                track={primary?.meta.track}
                device={primary?.meta.device}
                date={primary?.meta.date}
                time={primary?.meta.time}
                fastestLap={primary?.meta.fastestLap}
                fastestTime={primary?.meta.fastestTime}
                totalLaps={totalLaps}
                channels={totalChannels}
                files={loader.files.length}
                toolsets={loader.toolsets.length}
              />

              {loader.files.map((f, i) => (
                <PaperPanel
                  key={`ld-${i}`}
                  id={`ld-${i}`}
                  eyebrow="Telemetry"
                  title={f.fileName}
                  meta={[
                    { k: "Channels", v: String(f.channels.length) },
                    { k: "Laps", v: String(f.laps.length) },
                  ]}
                >
                  <ChannelTable channels={f.channels} lapCount={f.laps.length} />
                </PaperPanel>
              ))}

              {loader.toolsets.map((t, i) => (
                <div id={`ts-${i}`} key={`ts-${i}`}>
                  <ToolsetSummary toolset={t} ldFiles={loader.files} />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      <PitWallFooter />
    </div>
  );
}

/* ---------------------------- header --------------------------- */

function PitWallHeader({
  clock,
  status,
  files,
  toolsets,
  onReset,
  hasAnything,
}: {
  clock: Date;
  status: "IDLE" | "PARSING" | "ARMED";
  files: number;
  toolsets: number;
  onReset: () => void;
  hasAnything: boolean;
}) {
  const statusColor =
    status === "ARMED"
      ? "text-race-red"
      : status === "PARSING"
        ? "text-hazard"
        : "text-muted-foreground";

  return (
    <header className="sticky top-0 z-30 carbon-bg border-b-2 border-race-red text-bone">
      <div className="flex items-stretch">
        {/* Brand block */}
        <div className="flex items-center gap-3 bg-race-red px-5 py-3">
          <span className="font-display text-3xl leading-none tracking-widest">MOTEC</span>
          <span className="h-6 w-px bg-bone/40" />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-bone/90">
            Pit-Wall // Analyzer
          </span>
        </div>

        {/* Center status strip */}
        <div className="flex flex-1 items-center justify-between gap-6 px-5 py-3">
          <div className="flex items-center gap-4">
            <StatusLed status={status} />
            <span className={`font-mono text-xs uppercase tracking-widest ${statusColor}`}>
              {status}
            </span>
            <span className="hidden font-mono text-[11px] uppercase tracking-wider text-bone/60 sm:inline">
              {files} ld · {toolsets} toolset
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tracking-widest text-bone/60">
              {clock.toLocaleDateString("it-IT")}
            </span>
            <span className="font-mono text-base tabular-nums tracking-widest text-bone">
              {fmtTime(clock)}
            </span>
            {hasAnything && (
              <button
                onClick={onReset}
                className="ml-2 border border-bone/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-bone transition-colors hover:border-race-red hover:bg-race-red"
              >
                ⊘ New Session
              </button>
            )}
          </div>
        </div>
      </div>
      {/* hazard-tape sliver */}
      <div className="hazard-edge h-1 w-full" />
    </header>
  );
}

function StatusLed({ status }: { status: "IDLE" | "PARSING" | "ARMED" }) {
  const color =
    status === "ARMED" ? "bg-race-red" : status === "PARSING" ? "bg-hazard" : "bg-pit-grey";
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`block h-2.5 w-2.5 rounded-full ${color} ${
          status !== "IDLE" ? "blink-led" : ""
        }`}
      />
    </span>
  );
}

/* ---------------------------- sidebar -------------------------- */

function Sidebar({
  sections,
  loading,
  totalChannels,
  totalLaps,
  onAddFiles,
}: {
  sections: { id: string; label: string; kind: "ld" | "ts" | "session" }[];
  loading: boolean;
  totalChannels: number;
  totalLaps: number;
  onAddFiles: (files: File[]) => void;
}) {
  return (
    <aside className="sticky top-[68px] hidden h-[calc(100vh-68px)] w-64 shrink-0 self-start border-r-2 border-ink bg-card lg:flex lg:flex-col">
      <div className="border-b border-ink px-4 py-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          Sectors
        </div>
        <div className="mt-1 font-display text-2xl leading-none">Telemetry Index</div>
      </div>

      <nav className="flex-1 overflow-auto px-1 py-2">
        {sections.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Awaiting data
            </div>
            <div className="mt-2 text-xs text-muted-foreground/70">
              Carica un file per popolare l'indice.
            </div>
          </div>
        ) : (
          sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="group relative flex items-center gap-2 border-l-2 border-transparent px-3 py-2 font-mono text-xs uppercase tracking-wider text-foreground/80 transition-colors hover:border-race-red hover:bg-hazard/15 hover:text-foreground"
            >
              <span
                className={`inline-block h-1.5 w-1.5 ${
                  s.kind === "ts" ? "bg-hazard" : s.kind === "ld" ? "bg-race-red" : "bg-ink"
                }`}
              />
              <span className="truncate">{s.label}</span>
            </a>
          ))
        )}
      </nav>

      <div className="border-t border-ink px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <div className="flex justify-between">
          <span>Channels</span>
          <span className="text-foreground">{totalChannels}</span>
        </div>
        <div className="flex justify-between">
          <span>Laps</span>
          <span className="text-foreground">{totalLaps}</span>
        </div>
        <div className="flex justify-between">
          <span>Status</span>
          <span className={loading ? "text-hazard" : "text-foreground"}>
            {loading ? "PARSE" : "READY"}
          </span>
        </div>

        <label className="mt-3 block cursor-pointer border border-ink px-2 py-1.5 text-center text-[10px] tracking-widest text-foreground transition-colors hover:bg-hazard">
          + Add files
          <input
            type="file"
            accept=".ld,.ldx,.toolset"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onAddFiles(files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </aside>
  );
}

/* ---------------------------- empty ---------------------------- */

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <div className="mb-8 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
          ◉ Sessione in attesa
        </div>
        <h1 className="mt-3 font-display text-6xl leading-none tracking-wider">
          The car has not <span className="text-race-red">crossed the line</span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Carica i file di telemetria e configurazione. Parsing client-side, nessun upload.
        </p>
      </div>

      {children}

      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        <SpecCard title=".LD" body="Telemetria MoTeC, descrittori linked-list, dati int16/int32." />
        <SpecCard title=".LDX" body="Metadati XML: Total Laps, Fastest Lap, Fastest Time." />
        <SpecCard
          title=".TOOLSET"
          body="Archivio OPC del logger Porsche/Cosworth: CAN bus, range, allarmi, I/O."
        />
      </div>
    </div>
  );
}

function SpecCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="paper-card p-4">
      <div className="font-display text-2xl leading-none text-race-red">{title}</div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/* ---------------------------- ribbon --------------------------- */

function SessionRibbon({
  car,
  track,
  device,
  date,
  time,
  fastestLap,
  fastestTime,
  totalLaps,
  channels,
  files,
  toolsets,
}: {
  car?: string;
  track?: string;
  device?: string;
  date?: string;
  time?: string;
  fastestLap?: number;
  fastestTime?: string;
  totalLaps: number;
  channels: number;
  files: number;
  toolsets: number;
}) {
  return (
    <section id="session" className="relative">
      <div className="relative overflow-hidden paper-card">
        {/* diagonal red stripe */}
        <div className="ribbon-wipe pointer-events-none absolute inset-0 diag-stripe-red opacity-90" />

        <div className="relative grid gap-6 p-6 md:grid-cols-[1fr_auto]">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
              ◉ Session // Riepilogo
            </div>
            <h1 className="mt-2 font-display text-5xl leading-none tracking-wider md:text-6xl">
              {car ?? "Vettura n/d"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              <span>{track ?? "Pista n/d"}</span>
              <span>·</span>
              <span>{device || "Device n/d"}</span>
              <span>·</span>
              <span>{date || "Data n/d"}</span>
              <span>·</span>
              <span>Ora {time || "n/d"}</span>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <RibbonPill label="LD" value={files} />
              <RibbonPill label="TOOLSET" value={toolsets} tone="yellow" />
              <RibbonPill label="CHN" value={channels} />
              <RibbonPill label="LAPS" value={totalLaps} />
            </div>
          </div>

          {/* Lap time block */}
          <div className="flex shrink-0 flex-col items-end justify-between border-l border-ink/20 pl-6">
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Giro veloce
              </div>
              <div className="font-display text-7xl leading-none tabular-nums tracking-widest text-foreground">
                {fastestTime ?? "n/d"}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-race-red">
                {fastestLap ? `Giro ${fastestLap}` : "—"}
              </div>
            </div>
          </div>
        </div>


        {/* bottom hazard sliver */}
        <div className="hazard-edge h-1 w-full" />
      </div>
    </section>
  );
}

function RibbonPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "yellow";
}) {
  const cls =
    tone === "yellow"
      ? "border-ink bg-hazard text-ink"
      : "border-ink bg-card text-ink";
  return (
    <span className={`pit-pill ${cls}`}>
      <span className="opacity-70">{label}</span>
      <span className="text-sm font-bold">{value}</span>
    </span>
  );
}

/* ---------------------------- paper panel ---------------------- */

function PaperPanel({
  id,
  eyebrow,
  title,
  meta,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  meta?: { k: string; v: string }[];
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="paper-card">
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
      <div className="p-2">{children}</div>
    </section>
  );
}

/* ---------------------------- footer --------------------------- */

function PitWallFooter() {
  return (
    <footer className="carbon-bg mt-auto border-t-2 border-race-red text-bone/70">
      <div className="hazard-edge h-1 w-full" />
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 font-mono text-[10px] uppercase tracking-[0.25em]">
        <span>
          MoTeC // Pit-Wall Analyzer · client-side parsing · nessun dato lascia il browser
        </span>
        <span className="text-bone/40">v1 · race-ready</span>
      </div>
    </footer>
  );
}
