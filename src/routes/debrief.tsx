import { createFileRoute, Link } from "@tanstack/react-router";
import { useLdLoaderContext } from "@/context/LdLoaderContext";

export const Route = createFileRoute("/debrief")({
  head: () => ({
    meta: [
      { title: "Stint Analysis — MoTeC Pit-Wall Analyzer" },
      {
        name: "description",
        content: "Stint-level debrief analysis on already-loaded MoTeC telemetry files.",
      },
    ],
  }),
  component: DebriefPage,
  ssr: false,
});

function DebriefPage() {
  const { files } = useLdLoaderContext();

  return (
    <div className="min-h-screen bg-background px-6 py-8 font-mono text-foreground">
      <header className="mb-8 border-b border-border pb-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Analysis</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Stint Analysis</h1>
      </header>

      {files.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground">
          Nessun file caricato. Vai su{" "}
          <Link to="/" className="text-primary underline-offset-4 hover:underline">
            Overview
          </Link>{" "}
          per caricare i dati .ld / .ldx / .toolset.
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          {files.length} file caricat{files.length === 1 ? "o" : "i"}. Contenuto in arrivo.
        </div>
      )}
    </div>
  );
}
