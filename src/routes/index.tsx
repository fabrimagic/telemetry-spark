import { createFileRoute } from "@tanstack/react-router";
import { useLdLoader } from "@/hooks/useLdLoader";
import { FileDropzone } from "@/components/telemetry/FileDropzone";
import { ChannelTable } from "@/components/telemetry/ChannelTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MoTeC Telemetry Analyzer" },
      {
        name: "description",
        content:
          "Analizzatore di telemetria MoTeC: carica file .ld/.ldx e visualizza il riepilogo dei canali nel browser, nessun upload.",
      },
      { property: "og:title", content: "MoTeC Telemetry Analyzer" },
      {
        property: "og:description",
        content: "Parsing 100% client-side di file MoTeC .ld con riepilogo dei dati acquisiti.",
      },
    ],
  }),
  component: Index,
  ssr: false,
});

function Index() {
  const loader = useLdLoader();
  const primary = loader.files[0];

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

  const totalChannels = loader.files.reduce((a, f) => a + f.channels.length, 0);
  const totalLaps = loader.files.reduce((a, f) => a + f.laps.length, 0);
  const emptyChannels = loader.files.reduce(
    (a, f) => a + f.channels.filter((c) => c.empty).length,
    0,
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Riepilogo telemetria</h1>
            <p className="text-sm text-muted-foreground">
              Dati acquisiti dai file caricati. Nessun grafico, solo metadati e statistiche per
              canale.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={loader.reset}>
            Nuovo file
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <section className="rounded-lg border bg-card p-5">
          <h2 className="mb-3 text-base font-semibold">Sessione</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <Field label="Vettura" value={primary?.meta.car} />
            <Field label="Pista" value={primary?.meta.track} />
            <Field label="Device" value={primary?.meta.device} />
            <Field label="Data" value={primary?.meta.date} />
            <Field label="Ora" value={primary?.meta.time} />
            <Field
              label="Giro veloce"
              value={
                primary?.meta.fastestLap
                  ? `${primary.meta.fastestLap}${
                      primary.meta.fastestTime ? ` (${primary.meta.fastestTime})` : ""
                    }`
                  : undefined
              }
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">{loader.files.length} file</Badge>
            <Badge variant="secondary">{totalChannels} canali</Badge>
            <Badge variant="secondary">{totalLaps} giri</Badge>
            {emptyChannels > 0 && (
              <Badge variant="outline">{emptyChannels} canali vuoti</Badge>
            )}
          </div>
        </section>

        {loader.files.map((f, i) => (
          <section key={i} className="rounded-lg border bg-card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{f.fileName}</h2>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">{f.channels.length} canali</Badge>
                <Badge variant="secondary">{f.laps.length} giri</Badge>
              </div>
            </div>
            <ChannelTable channels={f.channels} />
          </section>
        ))}
      </main>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value || "n/d"}</div>
    </div>
  );
}
