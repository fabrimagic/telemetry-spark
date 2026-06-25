// Channel Mapping panel — diagnostic UI.
//
// Surfaces the output of `buildChannelMapping`: which logical keys are
// resolved (and on which physical channel), which are missing, and which
// physical channels in the file remain unused. No verdicts — only facts.
//
// Intended for onboarding new cars / firmwares: unmapped physical channels
// with real data AND toolset metadata are the most immediate candidates
// for new aliases in the channel resolver (we know what they are);
// unmapped channels with data but NO toolset metadata require external
// knowledge of the firmware before they can be exploited.

import { useMemo, useState } from "react";
import {
  buildChannelMapping,
  type ChannelMappingReport,
  type UnmappedStatus,
} from "@/lib/ld/channelMapping";

import type { LdFile } from "@/lib/ld/types";
import type {
  ToolsetChannelEntry,
  ToolsetDisplayMeta,
} from "@/lib/toolset/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  file: LdFile;
  toolsetMeta?: ToolsetDisplayMeta[];
  toolsetChannels?: ToolsetChannelEntry[];
}

export function ChannelMappingPanel({ file, toolsetMeta, toolsetChannels }: Props) {
  const report: ChannelMappingReport = useMemo(
    () => buildChannelMapping(file, { toolsetMeta, toolsetChannels }),
    [file, toolsetMeta, toolsetChannels],
  );
  const [showUnmapped, setShowUnmapped] = useState(false);
  const [unmappedFilter, setUnmappedFilter] = useState("");


  // Status ordering: data first (actionable), then constant, then empty.
  const STATUS_ORDER: Record<UnmappedStatus, number> = {
    data: 0,
    constant: 1,
    empty: 2,
  };

  const filteredUnmapped = useMemo(() => {
    const q = unmappedFilter.trim().toLowerCase();
    const list = q
      ? report.unmapped.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.category.toLowerCase().includes(q) ||
            c.unit.toLowerCase().includes(q) ||
            (c.toolsetUnit?.toLowerCase().includes(q) ?? false) ||
            (c.toolsetQuantity?.toLowerCase().includes(q) ?? false) ||
            (c.toolsetDescription?.toLowerCase().includes(q) ?? false),
        )
      : report.unmapped;
    // Sort by status (data → constant → empty), then channels WITH toolset
    // metadata first within each status, then category, then name.
    return [...list].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (sa !== 0) return sa;
      if (a.hasToolsetMeta !== b.hasToolsetMeta) return a.hasToolsetMeta ? -1 : 1;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });
  }, [report.unmapped, unmappedFilter]);


  const fmtNum = (v: number) =>
    Number.isFinite(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(3)) : "—";

  const STATUS_LABEL: Record<UnmappedStatus, string> = {
    data: "con dati",
    constant: "costante",
    empty: "vuoto",
  };
  const STATUS_DOT: Record<UnmappedStatus, string> = {
    data: "bg-emerald-500",
    constant: "bg-amber-500",
    empty: "bg-muted-foreground",
  };

  const { totals } = report;


  return (
    <div className="space-y-6">
      <p className="font-mono text-[11px] leading-snug text-muted-foreground">
        Strumento diagnostico per adattare l'app a file/vetture nuove. Mostra
        come i <em>logical key</em> dell'applicazione si risolvono sui canali
        fisici del file caricato. Tra i canali non mappati, solo quelli{" "}
        <strong>con dati</strong> (min ≠ max, valori finiti) sono candidati
        reali per nuovi alias nel resolver. I più immediati sono quelli che
        hanno anche <strong>metadati del toolset</strong> (descrizione,
        quantità, unità, range): sai già cosa rappresentano. Quelli con dati
        ma senza metadati richiedono conoscenza esterna del firmware prima di
        poter essere sfruttati. I canali <strong>costanti</strong>{" "}
        (min ≡ max, o min/max/avg NaN) e quelli <strong>vuoti</strong>{" "}
        (nessun campione) non porterebbero valore anche se mappati. La
        classificazione usa solo le statistiche già cachate dal parser
        (min/max/avg/nSamples) e i metadati già prodotti dal toolset
        (ToolsetDisplayMeta), nessuna inferenza. Limite dichiarato: non
        distinguiamo "popolato ma quasi sempre nullo" da min/max soli — un
        singolo campione non-zero basta a far apparire il canale "con dati".
        Il pannello resta diagnostico: non mappa nulla automaticamente,
        fornisce le informazioni per decidere.
      </p>



      {/* ---------- Resolved logical keys ---------- */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between border-b border-ink/20 pb-1">
          <h3 className="font-mono text-[11px] uppercase tracking-widest">
            Logical key risolti
          </h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {totals.resolvedKeys} / {totals.logicalKeys}
          </span>
        </div>
        {report.resolved.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            Nessun logical key risolto.
          </p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto border border-ink/20">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--ink)/0.3)]">
                <TableRow className="border-b border-ink/30">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Logical key</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Canale fisico</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">Hz</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Unità</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">N camp.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.resolved.map((r, i) => (
                  <TableRow
                    key={r.key}
                    className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""}`}
                  >
                    <TableCell className="font-mono text-xs">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      {r.key}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.channelName}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{r.freq}</TableCell>
                    <TableCell className="font-mono text-xs">{r.unit || "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{r.nSamples}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ---------- Unresolved logical keys ---------- */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between border-b border-ink/20 pb-1">
          <h3 className="font-mono text-[11px] uppercase tracking-widest">
            Logical key NON risolti
          </h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            {report.unresolved.length} / {totals.logicalKeys}
          </span>
        </div>
        {report.unresolved.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            Tutti i logical key sono risolti per questo file.
          </p>
        ) : (
          <div className="max-h-[320px] overflow-y-auto border border-ink/20">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--ink)/0.3)]">
                <TableRow className="border-b border-ink/30">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Logical key</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Pattern attesi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.unresolved.map((u, i) => (
                  <TableRow
                    key={u.key}
                    className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""}`}
                  >
                    <TableCell className="align-top font-mono text-xs">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500" />
                      {u.key}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {u.patterns.length === 0 ? "—" : u.patterns.join("  ·  ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* ---------- Unmapped physical channels ---------- */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/20 pb-1">
          <h3 className="font-mono text-[11px] uppercase tracking-widest">
            Canali fisici non mappati
          </h3>
          <span className="font-mono text-[11px] text-muted-foreground">
            <span className="text-emerald-600 dark:text-emerald-400">
              con dati: {totals.unmappedWithData}
            </span>
            <span className="ml-1 text-muted-foreground">
              (decifrabili: {totals.unmappedWithDataDecipherable} · opachi:{" "}
              {totals.unmappedWithDataOpaque})
            </span>
            {" · "}
            <span className="text-amber-600 dark:text-amber-400">
              costanti: {totals.unmappedConstant}
            </span>
            {" · "}
            <span>vuoti: {totals.unmappedEmpty}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowUnmapped((v) => !v)}
            className="h-7 rounded-none border border-ink/40 bg-card px-3 font-mono text-[10px] uppercase tracking-widest hover:bg-muted"
          >
            {showUnmapped ? "Nascondi elenco" : "Mostra elenco"}
          </button>
          {showUnmapped && (
            <input
              type="search"
              value={unmappedFilter}
              onChange={(e) => setUnmappedFilter(e.target.value)}
              placeholder="Filtra per nome / categoria / unità / descrizione…"
              className="h-7 flex-1 min-w-[200px] rounded-none border border-ink/40 bg-card px-2 font-mono text-xs"
            />
          )}
        </div>
        {showUnmapped && (
          <div className="max-h-[420px] overflow-x-auto overflow-y-auto border border-ink/20">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--ink)/0.3)]">
                <TableRow className="border-b border-ink/30">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Stato</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Categoria</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Nome canale</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Descrizione / quantità (toolset)</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Unità</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Range dichiarato</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">Hz</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">N camp.</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">Min</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">Max</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">Avg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnmapped.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="font-mono text-xs text-muted-foreground">
                      Nessun canale corrisponde al filtro.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUnmapped.map((c, i) => {
                    const hasData = c.status === "data";
                    const descOrQty = c.toolsetDescription ?? c.toolsetQuantity;
                    const unit = c.unit && c.unit.length > 0 ? c.unit : c.toolsetUnit ?? "";
                    const range =
                      c.toolsetMin !== undefined && c.toolsetMax !== undefined
                        ? `${fmtNum(c.toolsetMin)} … ${fmtNum(c.toolsetMax)}`
                        : "";
                    return (
                      <TableRow
                        key={`${c.name}-${i}`}
                        className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""} ${hasData ? "" : "opacity-70"}`}
                      >
                        <TableCell className="font-mono text-[11px] whitespace-nowrap">
                          <span className={`mr-2 inline-block h-2 w-2 rounded-full ${STATUS_DOT[c.status]}`} />
                          {STATUS_LABEL[c.status]}
                          {hasData && (
                            <span
                              className={`ml-2 inline-block rounded-sm border px-1 text-[9px] uppercase tracking-wider ${
                                c.hasToolsetMeta
                                  ? "border-emerald-500/60 text-emerald-600 dark:text-emerald-400"
                                  : "border-muted-foreground/40 text-muted-foreground"
                              }`}
                              title={
                                c.hasToolsetMeta
                                  ? "Metadati toolset disponibili — candidato immediato"
                                  : "Nessun metadato toolset — richiede conoscenza esterna"
                              }
                            >
                              {c.hasToolsetMeta ? "meta" : "no meta"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">{c.category}</TableCell>
                        <TableCell className="font-mono text-xs">{c.name}</TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground max-w-[280px]">
                          {descOrQty ? (
                            <>
                              {descOrQty}
                              {c.toolsetDescription && c.toolsetQuantity ? (
                                <span className="ml-1 opacity-70">[{c.toolsetQuantity}]</span>
                              ) : null}
                            </>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{unit || "—"}</TableCell>
                        <TableCell className="font-mono text-[11px] tabular-nums text-muted-foreground">
                          {range || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{c.freq}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{c.nSamples}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {hasData ? fmtNum(c.min) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {hasData ? fmtNum(c.max) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {hasData ? fmtNum(c.avg) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>


    </div>
  );
}
