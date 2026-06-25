// Traction Slip panel — visualises CALCULATED traction slip (rear-vs-front
// wheel-speed ratio) over the stint.
//
// Anti-hallucination discipline (mirrors the engine):
//  - Slip is COMPUTED from wheel speeds; the "abs Slip *" channels in the
//    file are null and unusable, and the TC intervention flag is not logged.
//  - In-corner samples are flagged as LESS reliable (track-width geometry
//    contaminates the rear/front ratio); not corrected.
//  - All thresholds shown are either declared (V_MIN_KMH, SLIP_SIGNIFICANT_PCT)
//    or derived from the data (corner indicator = 75th percentile).

import { useMemo } from "react";
import { buildTractionSlip, type TractionSlipStats } from "@/lib/ld/tractionSlip";
import type { LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";

export interface TractionSlipPanelProps {
  file: LdFile;
  laps: LapRow[];
}

function fmtPct(v: number, d = 2): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(d)} %`;
}

function fmtFrac(v: number, d = 1): string {
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)} %`;
}

function StatBlock({ title, s }: { title: string; s: TractionSlipStats }) {
  return (
    <div className="border border-ink/30 p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs tabular-nums">
        <div className="text-muted-foreground">Mediana</div>
        <div className="text-right">{fmtPct(s.median)}</div>
        <div className="text-muted-foreground">p95</div>
        <div className="text-right">{fmtPct(s.p95)}</div>
        <div className="text-muted-foreground">p99</div>
        <div className="text-right">{fmtPct(s.p99)}</div>
        <div className="text-muted-foreground">Max</div>
        <div className="text-right">{fmtPct(s.max)}</div>
        <div className="text-muted-foreground">% tempo &gt; soglia</div>
        <div className="text-right">{fmtFrac(s.fracOverThreshold)}</div>
        <div className="text-muted-foreground">Campioni</div>
        <div className="text-right">{s.count.toLocaleString()}</div>
      </div>
    </div>
  );
}

export function TractionSlipPanel({ file, laps }: TractionSlipPanelProps) {
  const result = useMemo(() => buildTractionSlip(file, laps), [file, laps]);

  if (!result.available) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        {result.message ?? "Slip in trazione non disponibile."}
      </p>
    );
  }

  const { thresholds, perLap, stint, zones, hasZones, lapsAnalysed } = result;

  return (
    <div className="space-y-5">
      <p className="text-[11px] leading-snug text-muted-foreground">
        Lo slip è una grandezza <strong>calcolata</strong> dalle velocità
        ruota: <code>slip% = (v_post − v_ant) / v_ant × 100</code>, con
        v_ant = media delle anteriori folli (riferimento veicolo) e v_post =
        media delle posteriori motrici. Non è una misura diretta né un canale
        di intervento del controllo di trazione (il flag intervento non è
        loggato in questi file). Campioni sotto v_ant&nbsp;&lt;&nbsp;
        {thresholds.vMinKmh}&nbsp;km/h sono esclusi (instabilità numerica).
        In curva la differenza di carreggiata inquina il rapporto: i campioni
        con |vFL−vFR|/v_ant ≥ {(thresholds.cornerIndicatorThreshold * 100).toFixed(2)}&nbsp;%
        (75° percentile osservato) sono marcati <em>in curva</em> e tenuti in
        statistiche separate, non corretti. Soglia &quot;slip significativo&quot;
        dichiarata a {thresholds.slipSignificantPct}&nbsp;%.
      </p>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Aggregato stint · {lapsAnalysed} giri validi
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatBlock title="Tutti i campioni" s={stint.overall} />
          <StatBlock title="Rettilineo / bassa sterzata (affidabili)" s={stint.straight} />
          <StatBlock title="In curva (meno affidabili)" s={stint.corner} />
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Evoluzione per giro · slip mediano e % tempo &gt; {thresholds.slipSignificantPct}&nbsp;%
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse font-mono text-xs">
            <thead>
              <tr className="border-b border-ink/40 text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-2 py-1 text-left">Lap</th>
                <th className="px-2 py-1 text-right">Med · tutti</th>
                <th className="px-2 py-1 text-right">p95 · tutti</th>
                <th className="px-2 py-1 text-right">Max · tutti</th>
                <th className="px-2 py-1 text-right">% &gt; soglia · tutti</th>
                <th className="px-2 py-1 text-right">Med · rett.</th>
                <th className="px-2 py-1 text-right">Med · curva</th>
              </tr>
            </thead>
            <tbody>
              {perLap.map((r) => (
                <tr key={r.lap} className="border-b border-ink/10">
                  <td className="px-2 py-1 text-left tabular-nums">L{r.lap}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtPct(r.overall.median)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtPct(r.overall.p95)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtPct(r.overall.max)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtFrac(r.overall.fracOverThreshold)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtPct(r.straight.median)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmtPct(r.corner.median)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Slip in uscita curva · georeferenziato sul giro di riferimento
        </div>
        {hasZones && zones ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse font-mono text-xs">
              <thead>
                <tr className="border-b border-ink/40 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-2 py-1 text-left">Zona</th>
                  <th className="px-2 py-1 text-right">Apex (m)</th>
                  <th className="px-2 py-1 text-right">Fine (m)</th>
                  <th className="px-2 py-1 text-right">Slip medio</th>
                  <th className="px-2 py-1 text-right">Slip max</th>
                  <th className="px-2 py-1 text-right">% &gt; soglia</th>
                  <th className="px-2 py-1 text-right">Campioni</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.label} className="border-b border-ink/10">
                    <td className="px-2 py-1 text-left">{z.label}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{z.zone.apexDist.toFixed(0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{z.zone.endDist.toFixed(0)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtPct(z.meanSlip)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtPct(z.maxSlip)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{fmtFrac(z.fracOverThreshold)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{z.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
              Finestra di uscita = [apex, fine zona-curva] sul giro di
              riferimento (fastest valido). Le zone sono quelle rilevate dal
              motore Lap Comparison sullo stesso giro; lo slip qui è il
              calcolato (non un canale di intervento TC). I valori in curva
              risentono della geometria di carreggiata: leggere come
              indicazioni relative fra curve, non come misura assoluta.
            </p>
          </div>
        ) : (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Zone-curva non disponibili sul giro di riferimento (manca Lap
            Distance o non sono state rilevate zone): la georeferenziazione
            non è possibile.
          </p>
        )}
      </div>
    </div>
  );
}
