import { useMemo, useState } from "react";
import type { Channel } from "@/lib/ld/types";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  channels: Channel[];
  lapCount?: number;
}

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) > 9999 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(2);
  return n.toFixed(3);
}

export function ChannelTable({ channels, lapCount }: Props) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return channels.filter((c) => !s || c.name.toLowerCase().includes(s));
  }, [channels, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-ink/20 p-3">
        <Input
          placeholder="Filtra canali…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md rounded-none border-ink/40 font-mono text-xs uppercase tracking-wider"
        />
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {filtered.length} / {channels.length}
        </div>
      </div>
      <div className="border-b border-ink/10 bg-hazard/10 px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-ink/80">
        N = campioni totali del canale nel file{lapCount && lapCount > 1 ? ` (intero file, ${lapCount} giri)` : ""}. Min/Max/Avg calcolati su tutti i campioni validi (sentinella −1 esclusi per distanze, tempi, contatori).
      </div>
      <ScrollArea className="max-h-[520px]">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow className="border-b border-ink/30">
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Channel</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Unit</TableHead>
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">Hz</TableHead>
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">N</TableHead>
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">Min</TableHead>
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">Max</TableHead>
              <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">Avg</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Cat</TableHead>
              <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Flag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c, i) => (
              <TableRow
                key={c.name}
                className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""} ${
                  c.badges.includes("verify") ? "pulse-hazard" : ""
                }`}
              >
                <TableCell className="font-mono text-xs">{c.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {c.unit || "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{c.freq}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{c.nSamples}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(c.min)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(c.max)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{fmt(c.avg)}</TableCell>
                <TableCell>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.category}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {c.empty && (
                      <Badge variant="outline" className="rounded-none border-ink/50 font-mono text-[9px] uppercase tracking-widest">
                        empty
                      </Badge>
                    )}
                    {c.badges.includes("special") && (
                      <Badge className="rounded-none border border-race-red bg-transparent font-mono text-[9px] uppercase tracking-widest text-race-red">
                        spec
                      </Badge>
                    )}
                    {c.badges.includes("verify") && (
                      <Badge className="rounded-none border border-ink bg-hazard font-mono text-[9px] uppercase tracking-widest text-ink">
                        ⚑ verify
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
