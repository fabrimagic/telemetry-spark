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
    <section className="rounded-lg border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Configurazione vettura (.toolset)</h2>
          <p className="text-xs text-muted-foreground">
            {toolset.fileName} · {formatBytes(toolset.byteLength)}
            {toolset.deviceHint ? ` · device: ${toolset.deviceHint}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{toolset.canBuses.length} bus CAN</Badge>
          <Badge variant="secondary">{toolset.channels.length} canali</Badge>
          <Badge variant="secondary">{toolset.displayMeta.length} con range/allarme</Badge>
          <Badge variant="secondary">{toolset.ioSensors.length} con I/O</Badge>
          <Badge variant="secondary">{toolset.calibrationHints.length} hint calibrazione</Badge>
          <Badge variant="secondary">{toolset.versions.length} versioni FW/HW</Badge>
          <Badge variant="secondary">{toolset.alarms.length} allarmi</Badge>
          {ldFiles.length > 0 && (
            <Badge variant="outline">
              {enrichableCount} canali .ld arricchibili con metadati .toolset
            </Badge>
          )}
        </div>
      </div>

      {/* CAN buses */}
      {toolset.canBuses.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold">Struttura CAN</h3>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Bus</TableHead>
                  <TableHead>Etichetta dominio</TableHead>
                  <TableHead className="text-right">Canali associabili</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {toolset.canBuses.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">CAN {b.id}</TableCell>
                    <TableCell>
                      {b.label || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.label ? (
                        b.channelCount
                      ) : (
                        <span className="text-muted-foreground">n/d</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Channels with range & alarm */}
      {toolset.displayMeta.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Canali con range e allarmi</h3>
            <div className="text-xs text-muted-foreground">
              {toolset.dashChannelBlocks} blocchi dash:Channel · {toolset.displayMeta.length} unici ·{" "}
              {significantCount} con range significativo
            </div>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <Input
              placeholder="Filtra per nome, categoria, unità…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-md"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="significant"
                checked={onlySignificant}
                onCheckedChange={(v) => setOnlySignificant(Boolean(v))}
              />
              <Label htmlFor="significant" className="cursor-pointer text-xs">
                Solo range significativi (esclude placeholder 0–1000)
              </Label>
            </div>
          </div>
          <div className="rounded-md border">
            <ScrollArea className="h-[420px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort("name")}>
                      Nome {sortIndicator(sortKey, sortDir, "name")}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer"
                      onClick={() => toggleSort("category")}
                    >
                      Categoria {sortIndicator(sortKey, sortDir, "category")}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right"
                      onClick={() => toggleSort("range")}
                    >
                      Range {sortIndicator(sortKey, sortDir, "range")}
                    </TableHead>
                    <TableHead
                      className="cursor-pointer text-right"
                      onClick={() => toggleSort("alarm")}
                    >
                      Allarme {sortIndicator(sortKey, sortDir, "alarm")}
                    </TableHead>
                    <TableHead className="text-right">Unità</TableHead>
                    <TableHead className="text-right">Decimali</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMeta.map((m) => (
                    <TableRow
                      key={m.sourceName}
                      className={m.alarmEnabled ? "bg-yellow-500/10" : undefined}
                    >
                      <TableCell className="font-mono text-xs">{m.sourceName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {m.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmtRange(m.minimum, m.maximum)}
                        {!m.hasSignificantRange &&
                          m.minimum !== undefined &&
                          m.maximum !== undefined && (
                            <span className="ml-1 text-[10px] text-muted-foreground">
                              (placeholder)
                            </span>
                          )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {m.alarmEnabled ? (
                          <span className="text-yellow-700 dark:text-yellow-300">
                            {fmtRange(m.alarmMinimum, m.alarmMaximum)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {fmtRange(m.alarmMinimum, m.alarmMaximum)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs">{m.userUnit || "—"}</TableCell>
                      <TableCell className="text-right text-xs">
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
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold">Sensori fisici (I/O)</h3>
          <Input
            placeholder="Filtra…"
            value={ioQ}
            onChange={(e) => setIoQ(e.target.value)}
            className="mb-2 max-w-md"
          />
          <div className="rounded-md border">
            <ScrollArea className="max-h-[320px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Porta</TableHead>
                    <TableHead>Categoria</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIo.map((s) => (
                    <TableRow key={s.name}>
                      <TableCell className="font-mono text-xs">{s.name}</TableCell>
                      <TableCell className="text-sm">{s.description}</TableCell>
                      <TableCell className="font-mono text-xs">{s.port}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {s.category}
                        </Badge>
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
        <div className="mb-4 rounded-md border bg-muted/20 p-3">
          <h3 className="mb-2 text-sm font-semibold">Hint di calibrazione</h3>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Riferimenti testuali grezzi, non applicati come fattori numerici.
          </p>
          <ul className="space-y-1 text-xs">
            {toolset.calibrationHints.map((h) => (
              <li key={h}>
                <code className="rounded bg-muted px-1 py-0.5">{h}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Firmware / Hardware versions */}
      {toolset.versions.length > 0 && (
        <details className="mb-4 rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Firmware / Hardware ({toolset.versions.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs">
            {toolset.versions.map((v) => (
              <li key={v}>
                <code className="rounded bg-muted px-1 py-0.5">{v}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* All channels */}
      {toolset.channels.length > 0 && (
        <details className="mb-4 rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Tutti i canali di configurazione ({toolset.channels.length})
          </summary>
          <Input
            placeholder="Filtra…"
            value={chQ}
            onChange={(e) => setChQ(e.target.value)}
            className="mb-2 mt-2 max-w-md"
          />
          <div className="rounded-md border">
            <ScrollArea className="h-[360px]">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Categoria</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredChannels.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell className="font-mono text-xs">{c.name}</TableCell>
                      <TableCell className="text-sm">
                        {c.description ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {c.category}
                        </Badge>
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
        <details className="mb-4 rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Allarmi / diagnostica ({toolset.alarms.length})
          </summary>
          <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs text-muted-foreground">
            {toolset.alarms.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Package parts */}
      <details className="mb-4 rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Parti del package OPC ({toolset.parts.length})
        </summary>
        <div className="mt-2 rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Compressione</TableHead>
                <TableHead className="text-right">Dim.</TableHead>
                <TableHead>Stato</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {toolset.parts.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="font-mono text-xs">{p.name}</TableCell>
                  <TableCell className="text-xs">{p.methodLabel}</TableCell>
                  <TableCell className="text-right text-xs">{formatBytes(p.size)}</TableCell>
                  <TableCell>
                    {p.extracted ? (
                      <Badge variant="secondary" className="text-[10px]">
                        estratto
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        non estratto
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>

      {/* Not extracted */}
      <div className="rounded-md border border-yellow-500/40 bg-yellow-500/5 p-3">
        <h3 className="mb-2 text-sm font-semibold text-yellow-700 dark:text-yellow-300">
          Non estratto
        </h3>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {toolset.notExtracted.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Stringhe leggibili totali in setup.binary: {toolset.setupStringCount}.
        </p>
      </div>
    </section>
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
