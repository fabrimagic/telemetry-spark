import { useMemo, useState } from "react";
import type { ToolsetFile } from "@/lib/toolset/types";
import type { LdFile } from "@/lib/ld/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  /** All loaded .ld files in the session, for cross-reference count. */
  ldFiles: LdFile[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ToolsetSummary({ toolset, ldFiles }: Props) {
  const [q, setQ] = useState("");
  const filteredChannels = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return toolset.channels;
    return toolset.channels.filter(
      (c) =>
        c.name.toLowerCase().includes(s) ||
        (c.description ?? "").toLowerCase().includes(s) ||
        c.category.toLowerCase().includes(s),
    );
  }, [toolset.channels, q]);

  // Cross-reference: how many .ld channel names match a toolset name OR description (exact, case-insensitive).
  const crossRefCount = useMemo(() => {
    if (ldFiles.length === 0 || toolset.channels.length === 0) return 0;
    const lookup = new Set<string>();
    for (const c of toolset.channels) {
      lookup.add(c.name.toLowerCase());
      if (c.description) lookup.add(c.description.toLowerCase());
    }
    let count = 0;
    const seen = new Set<string>();
    for (const f of ldFiles) {
      for (const ch of f.channels) {
        const key = ch.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (lookup.has(key)) count++;
      }
    }
    return count;
  }, [ldFiles, toolset.channels]);

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
          <Badge variant="secondary">{toolset.channels.length} nomi canale</Badge>
          <Badge variant="secondary">{toolset.alarms.length} allarmi</Badge>
          {toolset.versions.length > 0 && (
            <Badge variant="secondary">{toolset.versions.length} versioni FW/HW</Badge>
          )}
          {ldFiles.length > 0 && (
            <Badge variant="outline">
              {crossRefCount} canali .ld trovano una descrizione nel .toolset
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
                    <TableCell>{b.label || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right">
                      {b.label ? b.channelCount : <span className="text-muted-foreground">n/d</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Versions */}
      {toolset.versions.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold">Versioni firmware/hardware</h3>
          <ul className="space-y-1 text-sm">
            {toolset.versions.map((v) => (
              <li key={v} className="text-muted-foreground">
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{v}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Channels */}
      {toolset.channels.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-sm font-semibold">Canali di configurazione</h3>
          <Input
            placeholder="Filtra per nome, descrizione o categoria…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="mb-2 max-w-md"
          />
          <div className="rounded-md border">
            <ScrollArea className="h-[420px]">
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
        </div>
      )}

      {/* Alarms */}
      {toolset.alarms.length > 0 && (
        <details className="mb-4 rounded-md border bg-muted/30 p-3">
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
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold">Parti del package OPC</h3>
        <div className="rounded-md border">
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
                      <Badge variant="secondary" className="text-[10px]">estratto</Badge>
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
        {toolset.contentTypes.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            [Content_Types].xml: {toolset.contentTypes.length} dichiarazioni
          </p>
        )}
      </div>

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
