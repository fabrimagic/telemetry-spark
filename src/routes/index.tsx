import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useLdLoader } from "@/hooks/useLdLoader";
import { FileDropzone } from "@/components/telemetry/FileDropzone";
import { SessionBar, type ViewMode } from "@/components/telemetry/SessionBar";
import { ChannelSidebar } from "@/components/telemetry/ChannelSidebar";
import { ChartArea } from "@/components/telemetry/ChartArea";
import { ChannelTable } from "@/components/telemetry/ChannelTable";
import { GpsTrack } from "@/components/telemetry/GpsTrack";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MoTeC Telemetry Analyzer" },
      {
        name: "description",
        content:
          "Analizzatore di telemetria MoTeC: carica file .ld/.ldx e visualizza tutti i canali nel browser, nessun upload.",
      },
      { property: "og:title", content: "MoTeC Telemetry Analyzer" },
      {
        property: "og:description",
        content: "Parsing 100% client-side di file MoTeC .ld con dashboard interattiva.",
      },
    ],
  }),
  component: Index,
  ssr: false,
});

function Index() {
  const loader = useLdLoader();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ViewMode>("single");
  const [refLap, setRefLap] = useState({ fileIdx: 0, lapIdx: 0 });

  const primary = loader.files[0];
  const channels = useMemo(() => primary?.channels ?? [], [primary]);

  // Auto-select a useful default channel set on first load.
  const onLoaded = (names: string[]) => {
    if (selected.size > 0) return;
    const defaults = ["Drive Speed", "RPM", "ecu nmot", "Throttle", "Brake"];
    const init = new Set<string>();
    for (const d of defaults) {
      const found = names.find((n) => n.toLowerCase() === d.toLowerCase());
      if (found) init.add(found);
      if (init.size >= 3) break;
    }
    if (init.size === 0 && names.length > 0) init.add(names[0]);
    setSelected(init);
  };

  // Trigger default selection once channels are available.
  if (primary && selected.size === 0 && channels.length > 0) {
    queueMicrotask(() => onLoaded(channels.filter((c) => !c.empty).map((c) => c.name)));
  }

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const selectedChannels = useMemo(
    () => channels.filter((c) => selected.has(c.name)),
    [channels, selected],
  );

  if (loader.files.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b bg-card px-6 py-4">
          <h1 className="text-xl font-bold">MoTeC Telemetry Analyzer</h1>
          <p className="text-sm text-muted-foreground">
            Parsing client-side dei file .ld/.ldx — nessun dato lascia il browser.
          </p>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-12">
          <FileDropzone
            loading={loader.loading}
            progress={loader.progress}
            stage={loader.stage}
            error={loader.error}
            onFiles={loader.loadFiles}
          />
          <div className="mt-8 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            <h3 className="mb-2 font-semibold text-foreground">Cosa supporta</h3>
            <ul className="list-disc space-y-1 pl-5">
              <li>File <code>.ld</code> MoTeC con descrittori a linked list e dati int16/int32.</li>
              <li>Metadati opzionali da <code>.ldx</code> (Total Laps, Fastest Lap/Time).</li>
              <li>Conversioni speciali firmware (RPM, ecu nmot) e badge per canali da verificare.</li>
              <li>Segmentazione automatica giri da <code>Lap Number</code> / reset di <code>Lap Distance</code>.</li>
            </ul>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <SessionBar
        files={loader.files}
        mode={mode}
        onModeChange={setMode}
        refLap={refLap}
        onRefLapChange={setRefLap}
        onReset={loader.reset}
      />
      <div className="flex flex-1 overflow-hidden">
        <ChannelSidebar channels={channels} selected={selected} onToggle={toggle} />
        <main className="flex flex-1 flex-col overflow-hidden">
          <Tabs defaultValue="charts" className="flex h-full flex-col">
            <TabsList className="mx-4 mt-2 w-fit">
              <TabsTrigger value="charts">Grafici</TabsTrigger>
              <TabsTrigger value="table">Tabella canali</TabsTrigger>
              <TabsTrigger value="gps">Mappa GPS</TabsTrigger>
            </TabsList>
            <TabsContent value="charts" className="flex-1 overflow-hidden">
              <ChartArea
                files={loader.files}
                selected={selectedChannels}
                mode={mode}
                refLap={refLap}
              />
            </TabsContent>
            <TabsContent value="table" className="flex-1 overflow-hidden">
              <ChannelTable channels={channels} />
            </TabsContent>
            <TabsContent value="gps" className="flex-1 overflow-hidden">
              <GpsTrack file={primary!} />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  );
}
