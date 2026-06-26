// Handling Balance panel — visualises a RELATIVE tendency indicator
// (understeer / neutral / oversteer) derived from a simplified bicycle
// model. Anti-hallucination discipline mirrored from the engine: no
// absolute degree value is ever displayed; the index is dimensionless;
// the model assumptions are surfaced prominently.

import { useMemo } from "react";
import {
  buildHandlingBalance,
  type BalanceStats,
  type Tendency,
} from "@/lib/ld/handlingBalance";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";

export interface HandlingBalancePanelProps {
  file: LdFile;
  laps: LapRow[];
}

const TENDENCY_LABEL: Record<Tendency, string> = {
  understeer: "Tendenza al sottosterzo",
  neutral: "Bilanciato",
  oversteer: "Tendenza al sovrasterzo",
};

function fmtIdx(v: number): string {
  return Number.isFinite(v) ? v.toFixed(2) : "—";
}
function fmtFrac(v: number): string {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)} %` : "—";
}

/** Visual scale: under ↔ neutral ↔ over. Marker = median index, clipped
 *  to a display window of [0.5, 1.5]. NO absolute degree readout. */
function BalanceScale({ stats }: { stats: BalanceStats }) {
  const idx = stats.medianIndex;
  const min = 0.5, max = 1.5;
  const clipped = Number.isFinite(idx) ? Math.min(max, Math.max(min, idx)) : 1;
  const pct = ((clipped - min) / (max - min)) * 100;
  return (
    <div className="space-y-1">
      <div className="relative h-3 w-full border border-ink/40 bg-card">
        {/* neutral band shading */}
        <div
          className="absolute top-0 bottom-0 bg-ink/10"
          style={{ left: `${((0.85 - min) / (max - min)) * 100}%`, right: `${100 - ((1.15 - min) / (max - min)) * 100}%` }}
        />
        {Number.isFinite(idx) && (
          <div
            className="absolute top-[-3px] bottom-[-3px] w-[2px] bg-foreground"
            style={{ left: `calc(${pct}% - 1px)` }}
          />
        )}
      </div>
      <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>← sottosterzo</span>
        <span>neutro</span>
        <span>sovrasterzo →</span>
      </div>
    </div>
  );
}

function StatBlock({ title, s }: { title: string; s: BalanceStats }) {
  return (
    <div className="border border-ink/30 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="mt-2 text-xs font-mono">
        <div className="text-sm">{TENDENCY_LABEL[s.tendency]}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
          <div className="text-muted-foreground">Indice mediano</div>
          <div className="text-right">{fmtIdx(s.medianIndex)}</div>
          <div className="text-muted-foreground">% sottosterzo</div>
          <div className="text-right">{fmtFrac(s.fracUnder)}</div>
          <div className="text-muted-foreground">% neutro</div>
          <div className="text-right">{fmtFrac(s.fracNeutral)}</div>
          <div className="text-muted-foreground">% sovrasterzo</div>
          <div className="text-right">{fmtFrac(s.fracOver)}</div>
          <div className="text-muted-foreground">Campioni</div>
          <div className="text-right">{s.count.toLocaleString()}</div>
        </div>
      </div>
      <div className="mt-3">
        <BalanceScale stats={s} />
      </div>
    </div>
  );
}

export function HandlingBalancePanel({ file, laps }: HandlingBalancePanelProps) {
  const result = useMemo(() => buildHandlingBalance(file, laps), [file, laps]);

  if (!result.available) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        {result.message ?? "Handling Balance non disponibile."}
      </p>
    );
  }

  const { perLap, stint, zones, hasZones, lapsAnalysed, params, yawUnit } = result;

  return (
    <div className="space-y-5">
      <div className="border border-amber-500/40 bg-amber-500/5 p-3 text-[11px] leading-snug">
        <div className="font-mono text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-400">
          Avvertenza interpretativa
        </div>
        <p className="mt-1">
          Indice basato su un <strong>modello a bicicletta semplificato</strong>:
          ignora trasferimenti di carico, angoli di deriva pneumatici e cedevolezze
          di sospensione/telaio. Lo yaw atteso è calcolato come{" "}
          <code>v · δ / L</code> con <strong>L = {params.wheelbaseM} m</strong>{" "}
          (passo Porsche 992 GT3 R, valore ufficiale) e{" "}
          <strong>steering ratio ≈ {params.steeringRatio}:1</strong> —{" "}
          quest'ultimo è una <em>stima</em> per GT3 e influisce sulla{" "}
          <strong>scala</strong> dell'indice ma <strong>non</strong> sull'inversione
          della tendenza. Il risultato è un{" "}
          <strong>indicatore relativo di tendenza</strong>, mai una misura
          assoluta in gradi. Valido solo con v &gt; {params.vMinKmh}&nbsp;km/h e
          sterzo &gt; {params.steerMinDeg}°. Allineamento dei canali per{" "}
          <strong>tempo reale</strong> (non per indice di campione) — yaw rate
          letto come <code>{yawUnit}</code>. Il giudizio finale resta
          all'ingegnere, da incrociare con feedback pilota e dati gomme/sospensioni.
        </p>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Aggregato stint · {lapsAnalysed} giri validi
        </div>
        <div className="mt-2">
          <StatBlock title="Tendenza prevalente · stint" s={stint} />
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Evoluzione per giro · cambia bilanciamento col degrado?
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-ink/40 text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-2 py-1 text-left">Lap</th>
                <th className="px-2 py-1 text-left">Tendenza</th>
                <th className="px-2 py-1 text-right">Idx mediano</th>
                <th className="px-2 py-1 text-right">% sotto</th>
                <th className="px-2 py-1 text-right">% neutro</th>
                <th className="px-2 py-1 text-right">% sovra</th>
                <th className="px-2 py-1 text-right">Campioni</th>
              </tr>
            </thead>
            <tbody>
              {perLap.map((r) => (
                <tr key={r.lap} className="border-b border-ink/10">
                  <td className="px-2 py-1 text-left tabular-nums">L{r.lap}</td>
                  <td className="px-2 py-1 text-left">{TENDENCY_LABEL[r.stats.tendency]}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtIdx(r.stats.medianIndex)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtFrac(r.stats.fracUnder)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtFrac(r.stats.fracNeutral)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtFrac(r.stats.fracOver)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{r.stats.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Tendenza per zona-curva · georeferenziato sul giro di riferimento
        </div>
        {hasZones && zones ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-ink/40 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-2 py-1 text-left">Zona</th>
                  <th className="px-2 py-1 text-right">Inizio (m)</th>
                  <th className="px-2 py-1 text-right">Apex (m)</th>
                  <th className="px-2 py-1 text-right">Fine (m)</th>
                  <th className="px-2 py-1 text-left">Tendenza</th>
                  <th className="px-2 py-1 text-right">Idx mediano</th>
                  <th className="px-2 py-1 text-right">% sotto</th>
                  <th className="px-2 py-1 text-right">% sovra</th>
                  <th className="px-2 py-1 text-right">Campioni</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.label} className="border-b border-ink/10">
                    <td className="px-2 py-1 text-left">{z.label}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{z.zone.startDist.toFixed(0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{z.zone.apexDist.toFixed(0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{z.zone.endDist.toFixed(0)}</td>
                    <td className="px-2 py-1 text-left">{TENDENCY_LABEL[z.stats.tendency]}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtIdx(z.stats.medianIndex)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtFrac(z.stats.fracUnder)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtFrac(z.stats.fracOver)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{z.stats.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              Le zone-curva sono quelle rilevate dal motore Lap Comparison sul
              giro di riferimento (fastest valido). La tendenza è qualitativa
              attorno al valore neutro (banda ±{(params.neutralBand * 100).toFixed(0)}%).
              Da leggere come confronto relativo fra curve, non come misura
              assoluta in gradi.
            </p>
          </div>
        ) : (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Zone-curva non disponibili sul giro di riferimento: la
            georeferenziazione per curva non è possibile.
          </p>
        )}
      </div>
    </div>
  );
}
