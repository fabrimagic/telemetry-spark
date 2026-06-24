import { useMemo, useState } from "react";
import type { ToolsetDisplayMeta, ToolsetFile } from "@/lib/toolset/types";
import type { LdFile } from "@/lib/ld/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  toolset: ToolsetFile;
  ldFiles: LdFile[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtNum(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000 || Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}

function fmtRange(min: number | undefined, max: number | undefined): string {
  if (min === undefined && max === undefined) return "—";
  return `${fmtNum(min)} – ${fmtNum(max)}`;
}

/** Normalize a channel name for cross-format matching: underscore<->space, lowercase, collapsed spaces. */
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[_\s]+/g, " ").trim();
}

type SortKey = "name" | "category" | "range" | "alarm";

export function ToolsetSummary({ toolset, ldFiles }: Props) {
  const [q, setQ] = useState("");
  const [onlySignificant, setOnlySignificant] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [ioQ, setIoQ] = useState("");
  const [chQ, setChQ] = useState("");

  // ---- Display meta (range/alarm) table ----
  const filteredMeta = useMemo(() => {
    const s = q.trim().toLowerCase();
    let rows = toolset.displayMeta;
    if (onlySignificant) rows = rows.filter((r) => r.hasSignificantRange);
    if (s) {
      rows = rows.filter(
        (r) =>
          r.sourceName.toLowerCase().includes(s) ||
          r.category.toLowerCase().includes(s) ||
          (r.userUnit ?? "").toLowerCase().includes(s) ||
          (r.quantity ?? "").toLowerCase().includes(s),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => dir * compareMeta(a, b, sortKey));
  }, [toolset.displayMeta, q, onlySignificant, sortKey, sortDir]);

  // ---- IO sensors ----
  const filteredIo = useMemo(() => {
    const s = ioQ.trim().toLowerCase();
    if (!s) return toolset.ioSensors;
    return toolset.ioSensors.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        r.description.toLowerCase().includes(s) ||
        r.port.toLowerCase().includes(s) ||
        r.category.toLowerCase().includes(s),
    );
  }, [toolset.ioSensors, ioQ]);

  // ---- All channels ----
  const filteredChannels = useMemo(() => {
    const s = chQ.trim().toLowerCase();
    if (!s) return toolset.channels;
    return toolset.channels.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        (c.description ?? "").toLowerCase().includes(s) ||
        c.category.toLowerCase().includes(s),
    );
  }, [toolset.channels, chQ]);

  // ---- Cross-ref .ld <-> .toolset (normalized underscore<->space) ----
  const enrichableCount = useMemo(() => {
    if (ldFiles.length === 0) return 0;
    const lookup = new Set<string>();
    for (const c of toolset.channels) {
      lookup.add(normalizeName(c.name));
      if (c.description) lookup.add(normalizeName(c.description));
    }
    for (const m of toolset.displayMeta) {
      lookup.add(normalizeName(m.sourceName));
    }
    let count = 0;
    const seen = new Set<string>();
    for (const f of ldFiles) {
      for (const ch of f.channels) {
        const key = normalizeName(ch.name);
        if (seen.has(key)) continue;
        seen.add(key);
        if (lookup.has(key)) count++;
      }
    }
    return count;
  }, [ldFiles, toolset.channels, toolset.displayMeta]);

  const significantCount = useMemo(
    () => toolset.displayMeta.filter((m) => m.hasSignificantRange).length,
    [toolset.displayMeta],
  );

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  return (
    <section className="paper-card">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/30 px-5 py-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
            ◉ Vehicle config // .toolset
          </div>
          <h2 className="font-display text-3xl leading-none tracking-wider">
            {toolset.fileName}
          </h2>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {formatBytes(toolset.byteLength)}
            {toolset.deviceHint ? ` · device ${toolset.deviceHint}` : ""}
          </p>
        </div>
        <div className="flex max-w-xl flex-wrap justify-end gap-1.5">
          <CountChip label="CAN" value={toolset.canBuses.length} />
          <CountChip label="Channels" value={toolset.channels.length} />
          <CountChip label="Range/Alarm" value={toolset.displayMeta.length} tone="red" />
          <CountChip label="I/O" value={toolset.ioSensors.length} />
          <CountChip label="Calib" value={toolset.calibrationHints.length} />
          <CountChip label="FW/HW" value={toolset.versions.length} />
          <CountChip label="Alarms" value={toolset.alarms.length} tone="yellow" />
          {ldFiles.length > 0 && (
            <CountChip label="LD enrichable" value={enrichableCount} tone="outline" />
          )}
        </div>
      </header>

      <div className="space-y-6 p-5">

      {/* CAN buses — 8-cell pit-board grid */}
      {toolset.canBuses.length > 0 && (
        <div>
          <SectionTitle eyebrow="Network" title="CAN Bus Topology" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {toolset.canBuses.map((b) => (
              <div
                key={b.id}
                className="group relative border border-ink bg-card p-3 transition-colors hover:bg-hazard/10"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-3xl leading-none tracking-widest text-race-red">
                    CAN{b.id}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    bus
                  </span>

                </div>
                <div className="mt-2 truncate font-mono text-xs uppercase tracking-wider text-foreground">
                  {b.label || "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Channels with range & alarm */}
      {toolset.displayMeta.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <SectionTitle eyebrow="Telemetry · Range/Alarm" title="Canali con range e allarmi" />
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {toolset.dashChannelBlocks} blocchi · {toolset.displayMeta.length} unici ·{" "}
              {significantCount} significativi
            </div>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Filtra per nome, categoria, unità…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-md rounded-none border-ink/40 font-mono text-xs uppercase tracking-wider"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="significant"
                checked={onlySignificant}
                onCheckedChange={(v) => setOnlySignificant(Boolean(v))}
              />
              <Label
                htmlFor="significant"
                className="cursor-pointer font-mono text-[10px] uppercase tracking-widest"
              >
                Solo range significativi
              </Label>
            </div>
          </div>
          <div className="border border-ink/30">
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow className="border-b border-ink/30">
                    <TableHead
                      className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-foreground"
                      onClick={() => toggleSort("name")}
                    >
                      Name {sortIndicator(sortKey, sortDir, "name")}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-foreground"
                      onClick={() => toggleSort("category")}
                    >
                      Cat {sortIndicator(sortKey, sortDir, "category")}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right font-mono text-[10px] uppercase tracking-widest text-foreground"
                      onClick={() => toggleSort("range")}
                    >
                      Range {sortIndicator(sortKey, sortDir, "range")}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right font-mono text-[10px] uppercase tracking-widest text-foreground"
                      onClick={() => toggleSort("alarm")}
                    >
                      Alarm {sortIndicator(sortKey, sortDir, "alarm")}
                    </TableHead>
                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">
                      Unit
                    </TableHead>
                    <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">
                      Dec
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMeta.map((m, i) => (
                    <TableRow
                      key={m.sourceName}
                      className={`border-b border-ink/10 ${
                        m.alarmEnabled
                          ? "pulse-hazard"
                          : i % 2
                            ? "bg-muted/30"
                            : ""
                      }`}
                    >
                      <TableCell className="font-mono text-xs">{m.sourceName}</TableCell>
                      <TableCell>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {m.category}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmtRange(m.minimum, m.maximum)}
                        {!m.hasSignificantRange &&
                          m.minimum !== undefined &&
                          m.maximum !== undefined && (
                            <span className="ml-1 text-[10px] opacity-60">(default)</span>
                          )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {m.alarmEnabled ? (
                          <span className="font-bold text-ink">
                            ⚑ {fmtRange(m.alarmMinimum, m.alarmMaximum)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {fmtRange(m.alarmMinimum, m.alarmMaximum)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {m.userUnit || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {m.decimalPlaces ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </div>
      )}

      {/* I/O sensors */}
      {toolset.ioSensors.length > 0 && (
        <div>
          <SectionTitle eyebrow="Hardware" title="Sensori fisici · I/O" />
          <Input
            placeholder="Filtra…"
            value={ioQ}
            onChange={(e) => setIoQ(e.target.value)}
            className="mb-2 max-w-md rounded-none border-ink/40 font-mono text-xs uppercase tracking-wider"
          />
          <div className="border border-ink/30">
            <ScrollArea className="max-h-[320px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow className="border-b border-ink/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Name</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Description</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Port</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Cat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIo.map((s, i) => (
                    <TableRow key={s.name} className={`border-b border-ink/10 ${i % 2 ? "bg-muted/30" : ""}`}>
                      <TableCell className="font-mono text-xs">{s.name}</TableCell>
                      <TableCell className="text-sm">{s.description}</TableCell>
                      <TableCell>
                        <span className="pit-pill border-race-red text-race-red">{s.port}</span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {s.category}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </div>
      )}

      {/* Calibration hints */}
      {toolset.calibrationHints.length > 0 && (
        <div className="border border-ink/30 bg-muted/30 p-4">
          <SectionTitle eyebrow="Reference · raw" title="Hint di calibrazione" />
          <p className="-mt-2 mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Testo grezzo · non applicato come fattore numerico
          </p>
          <ul className="space-y-1.5">
            {toolset.calibrationHints.map((h) => (
              <li key={h}>
                <code className="border border-ink/30 bg-card px-2 py-0.5 text-xs">{h}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Firmware / Hardware */}
      {toolset.versions.length > 0 && (
        <details className="border border-ink/30 bg-muted/20 p-4">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
            ◉ Firmware / Hardware · {toolset.versions.length}
          </summary>
          <ul className="mt-3 max-h-64 space-y-1 overflow-auto">
            {toolset.versions.map((v) => (
              <li key={v}>
                <code className="border border-ink/20 bg-card px-2 py-0.5 text-xs">{v}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* All channels */}
      {toolset.channels.length > 0 && (
        <details className="border border-ink/30 p-4">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
            ◉ Tutti i canali di configurazione · {toolset.channels.length}
          </summary>
          <Input
            placeholder="Filtra…"
            value={chQ}
            onChange={(e) => setChQ(e.target.value)}
            className="mb-2 mt-3 max-w-md rounded-none border-ink/40 font-mono text-xs uppercase tracking-wider"
          />
          <div className="border border-ink/30">
            <ScrollArea className="h-[360px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow className="border-b border-ink/30">
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Name</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Description</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Cat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredChannels.map((c, i) => (
                    <TableRow key={c.name} className={`border-b border-ink/10 ${i % 2 ? "bg-muted/30" : ""}`}>
                      <TableCell className="font-mono text-xs">{c.name}</TableCell>
                      <TableCell className="text-sm">
                        {c.description ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {c.category}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </details>
      )}

      {/* Alarms */}
      {toolset.alarms.length > 0 && (
        <details className="border border-ink/30 bg-hazard/10 p-4">
          <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
            ⚑ Allarmi / diagnostica · {toolset.alarms.length}
          </summary>
          <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-xs text-muted-foreground">
            {toolset.alarms.map((a) => (
              <li key={a}>· {a}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Package parts */}
      <details className="border border-ink/30 p-4">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
          ◉ Package OPC · {toolset.parts.length} parti
        </summary>
        <div className="mt-3 border border-ink/30">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-ink/30">
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Name</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Compr</TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">Size</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toolset.parts.map((p, i) => (
                <TableRow key={p.name} className={`border-b border-ink/10 ${i % 2 ? "bg-muted/30" : ""}`}>
                  <TableCell className="font-mono text-xs">{p.name}</TableCell>
                  <TableCell className="font-mono text-xs">{p.methodLabel}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatBytes(p.size)}
                  </TableCell>
                  <TableCell>
                    {p.extracted ? (
                      <span className="pit-pill border-ink text-ink">extracted</span>
                    ) : (
                      <span className="pit-pill border-race-red text-race-red">skipped</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>


      {/* Not extracted — hazard tape block */}
      <div className="relative border-2 border-ink bg-card">
        <div className="hazard-edge h-2 w-full" />
        <div className="p-4">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
              ⚑ Yellow flag
            </span>
            <h3 className="font-display text-xl leading-none tracking-wider">Non estratto</h3>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            {toolset.notExtracted.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Stringhe leggibili totali in setup.binary · {toolset.setupStringCount}
          </p>
        </div>
        <div className="hazard-edge h-2 w-full" />
      </div>

      </div>
    </section>
  );
}

function CountChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "red" | "yellow" | "outline";
}) {
  const cls =
    tone === "red"
      ? "border-race-red text-race-red bg-card"
      : tone === "yellow"
        ? "border-ink bg-hazard text-ink"
        : tone === "outline"
          ? "border-dashed border-ink text-ink bg-card"
          : "border-ink text-ink bg-card";
  return (
    <span className={`pit-pill ${cls}`}>
      <span className="opacity-70">{label}</span>
      <span className="text-sm font-bold tabular-nums">{value}</span>
    </span>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-race-red">
        ◉ {eyebrow}
      </div>
      <h3 className="font-display text-2xl leading-none tracking-wider">{title}</h3>
    </div>
  );
}

function compareMeta(a: ToolsetDisplayMeta, b: ToolsetDisplayMeta, k: SortKey): number {
  switch (k) {
    case "name":
      return a.sourceName.localeCompare(b.sourceName);
    case "category":
      return a.category.localeCompare(b.category) || a.sourceName.localeCompare(b.sourceName);
    case "range": {
      const aw = (a.maximum ?? 0) - (a.minimum ?? 0);
      const bw = (b.maximum ?? 0) - (b.minimum ?? 0);
      return aw - bw;
    }
    case "alarm": {
      const ae = a.alarmEnabled ? 1 : 0;
      const be = b.alarmEnabled ? 1 : 0;
      return ae - be || a.sourceName.localeCompare(b.sourceName);
    }
  }
}

function sortIndicator(active: SortKey, dir: "asc" | "desc", k: SortKey): string {
  if (active !== k) return "";
  return dir === "asc" ? "↑" : "↓";
}

