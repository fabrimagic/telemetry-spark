// Thermal Balance panel — presents the relationship between tyre and brake
// thermal signals already aggregated by buildTyreEvolution and
// buildBrakeManagement.
//
// Interpretive constraint: this panel NEVER states setup verdicts. Numbers
// are shown as objective measurements; any engineering reading is rendered
// as a CONDITIONAL HYPOTHESIS ("observed X — compatible with Y; verify with
// Z"). Partial deltas (single side / single axle due to missing sensors) are
// shown as raw numbers but excluded from interpretive readings, and labeled
// explicitly as non-representative. A reinforced disclaimer closes the
// panel.

import { useMemo } from "react";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import {
  buildThermalBalance,
  type ThermalAxisFigure,
} from "@/lib/ld/thermalBalance";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function fmt(n: number | undefined, d = 1): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(d)}`;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-xs text-muted-foreground">{children}</p>;
}

function AxisCell({ fig, unit }: { fig: ThermalAxisFigure | undefined; unit: string }) {
  if (!fig) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="font-mono text-xs tabular-nums">
      {fmt(fig.value, 1)} {unit}
      {fig.partial && (
        <span
          className="ml-2 text-[9px] uppercase tracking-widest text-race-red"
          title={fig.partialNote ?? "Delta parziale: non rappresentativo dell'intera vettura."}
        >
          parziale
        </span>
      )}
    </span>
  );
}

export function ThermalBalancePanel({
  file,
  laps,
  toolsetMeta,
}: {
  file: LdFile;
  laps: LapRow[];
  toolsetMeta: ToolsetDisplayMeta[] | undefined;
}) {
  const result = useMemo(
    () => buildThermalBalance(file, laps, toolsetMeta),
    [file, laps, toolsetMeta],
  );

  const Disclaimer = (
    <div className="border border-ink/15 bg-muted/30 p-3">
      <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-bold text-ink">Nota interpretativa.</span> Questo
        pannello mette in relazione segnali termici misurati ma{" "}
        <span className="font-bold">non determina il setup</span>. La
        temperatura di gomme e dischi dipende da molti fattori non osservabili
        nei soli dati di telemetria (aerodinamica, distribuzione pesi, mescola,
        pressioni, raffreddamento). Le letture qui sotto sono{" "}
        <span className="font-bold">ipotesi condizionali</span> da verificare
        con pressioni, tempi sul giro e feedback del pilota. Il giudizio sul
        setup resta interamente all'ingegnere.
      </p>
    </div>
  );

  if (result.kind !== "ok") {
    return (
      <div className="space-y-4">
        {Disclaimer}
        <Notice>{result.message}</Notice>
      </div>
    );
  }

  const { tyre, brake, readings } = result;

  return (
    <div className="space-y-5">
      {Disclaimer}

      {/* Convention header */}
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Convenzione segni · asse: <span className="text-ink">+ = anteriore più caldo</span> ·
        {" "}lato: <span className="text-ink">+ = sinistra più calda</span>
      </p>

      {/* Objective table */}
      <div className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Livello 1 · Quadro termico oggettivo
        </h4>
        <div className="overflow-x-auto border border-ink/20">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-ink/30">
                <TableHead className="font-mono text-[10px] uppercase tracking-widest">Sorgente</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest">Δ asse (F − R)</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest">Δ lato (L − R)</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest">Evoluzione Δ asse</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="border-b border-ink/10">
                <TableCell className="font-mono text-xs">Gomme (TPMS)</TableCell>
                <TableCell>
                  {tyre.available
                    ? <AxisCell fig={tyre.axle} unit="°C" />
                    : <span className="font-mono text-xs text-muted-foreground">non disponibile</span>}
                </TableCell>
                <TableCell>
                  {tyre.available
                    ? <AxisCell fig={tyre.side} unit="°C" />
                    : <span className="font-mono text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {tyre.available
                    ? (tyre.axleEvolution !== undefined
                        ? <span className="font-mono text-xs tabular-nums">{fmt(tyre.axleEvolution, 1)} °C (last − first)</span>
                        : <span className="font-mono text-xs text-muted-foreground">—</span>)
                    : <span className="font-mono text-xs text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
              <TableRow className="border-b border-ink/10 bg-muted/40">
                <TableCell className="font-mono text-xs">Freni (dischi)</TableCell>
                <TableCell>
                  {brake.available
                    ? <AxisCell fig={brake.axle} unit="°C" />
                    : <span className="font-mono text-xs text-muted-foreground">non disponibile</span>}
                </TableCell>
                <TableCell>
                  {brake.available
                    ? <AxisCell fig={brake.side} unit="°C" />
                    : <span className="font-mono text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  {brake.available
                    ? (brake.axleEvolution !== undefined
                        ? <span className="font-mono text-xs tabular-nums">{fmt(brake.axleEvolution, 1)} °C (last − first)</span>
                        : <span className="font-mono text-xs text-muted-foreground">—</span>)
                    : <span className="font-mono text-xs text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        {(tyre.axle?.partial || tyre.side?.partial || brake.axle?.partial || brake.side?.partial) && (
          <p className="font-mono text-[10px] text-race-red">
            Alcuni delta sono parziali (sensori mancanti per lato o asse): mostrati come riferimento
            ma <span className="font-bold">esclusi</span> dalle letture interpretative.
          </p>
        )}
        {tyre.warmupLaps !== undefined && (
          <p className="font-mono text-[10px] text-muted-foreground">
            Warm-up gomme stimato: ≈ {tyre.warmupLaps} {tyre.warmupLaps === 1 ? "giro" : "giri"}.
          </p>
        )}
      </div>

      {/* Engineering readings — conditional hypotheses */}
      <div className="space-y-2">
        <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Livello 2 · Lettura ingegneristica (ipotesi condizionali)
        </h4>
        {readings.length === 0 ? (
          <Notice>
            Nessuna lettura rappresentativa: o i delta termici non sono significativi rispetto alla
            dispersione tra ruote, o i dati disponibili sono parziali.
          </Notice>
        ) : (
          <ul className="space-y-2">
            {readings.map((r) => (
              <li
                key={r.id}
                className="border-l-2 border-ink/40 bg-muted/20 px-3 py-2 font-mono text-xs leading-relaxed"
              >
                {r.text}
              </li>
            ))}
          </ul>
        )}
        <p className="font-mono text-[10px] text-muted-foreground">
          Soglia di rilevanza: |Δ| confrontato con la deviazione standard dei
          delta termici per ruota dello stesso engine (scala derivata dai dati,
          non da un assoluto). Sotto soglia, viene dichiarato bilanciamento
          neutro anziché forzare un'interpretazione.
        </p>
      </div>
    </div>
  );
}
