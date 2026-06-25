// Channel Mapping panel — diagnostic UI.
//
// Surfaces the output of `buildChannelMapping`: which logical keys are
// resolved (and on which physical channel), which are missing, and which
// physical channels in the file remain unused. No verdicts — only facts.
//
// Intended for onboarding new cars / firmwares: unmapped physical channels
// are candidates for new aliases in the channel resolver; unresolved
// logical keys flag features that will be degraded for this file.

import { useMemo, useState } from "react";
import {
  buildChannelMapping,
  type ChannelMappingReport,
  type UnmappedStatus,
} from "@/lib/ld/channelMapping";

import type { LdFile } from "@/lib/ld/types";
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
}

export function ChannelMappingPanel({ file }: Props) {
  const report: ChannelMappingReport = useMemo(
    () => buildChannelMapping(file),
    [file],
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
            c.unit.toLowerCase().includes(q),
        )
      : report.unmapped;
    // Sort by status (data → constant → empty), then category, then name.
    return [...list].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (sa !== 0) return sa;
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
        fisici del file caricato. I canali non mappati sono candidati per nuovi
        alias nel resolver; i logical key non risolti indicano funzionalità che
        resteranno degradate per questo file. Nessuna interpretazione: solo
        fatti di matching.
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
            {totals.unmappedChannels} / {totals.usableChannels}
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
              placeholder="Filtra per nome / categoria / unità…"
              className="h-7 flex-1 min-w-[200px] rounded-none border border-ink/40 bg-card px-2 font-mono text-xs"
            />
          )}
        </div>
        {showUnmapped && (
          <div className="max-h-[420px] overflow-y-auto border border-ink/20">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--ink)/0.3)]">
                <TableRow className="border-b border-ink/30">
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Categoria</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Nome canale</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">Hz</TableHead>
                  <TableHead className="font-mono text-[10px] uppercase tracking-widest">Unità</TableHead>
                  <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest">N camp.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnmapped.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="font-mono text-xs text-muted-foreground">
                      Nessun canale corrisponde al filtro.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUnmapped.map((c, i) => (
                    <TableRow
                      key={`${c.name}-${i}`}
                      className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""}`}
                    >
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{c.category}</TableCell>
                      <TableCell className="font-mono text-xs">{c.name}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{c.freq}</TableCell>
                      <TableCell className="font-mono text-xs">{c.unit || "—"}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">{c.nSamples}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
