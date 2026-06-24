import { useMemo, useState } from "react";
import type { LdFile } from "@/lib/ld/types";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import { buildSessionDebrief, type DebriefEvent, type DebriefSeverity } from "@/lib/ld/sessionDebrief";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  file: LdFile;
  toolsetMeta?: ToolsetDisplayMeta[];
}

const SEV_LABEL: Record<DebriefSeverity, string> = {
  alarm: "alarm",
  diag: "diag",
  threshold: "threshold",
  physical: "physical",
};

function sevBadgeClass(s: DebriefSeverity): string {
  switch (s) {
    case "alarm":
      return "border border-race-red bg-race-red/15 text-race-red";
    case "threshold":
    case "diag":
      return "border border-hazard bg-hazard/20 text-ink";
    case "physical":
    default:
      return "border border-ink/40 bg-transparent text-ink";
  }
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(2).padStart(5, "0")}`;
}

function fmtNum(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (Math.abs(n) > 9999 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(2);
  return n.toFixed(3);
}

export function SessionDebrief({ file, toolsetMeta }: Props) {
  const events = useMemo(
    () => buildSessionDebrief(file, toolsetMeta || []),
    [file, toolsetMeta],
  );

  const [lapFilter, setLapFilter] = useState<number | "all">("all");

  const counts = useMemo(() => {
    const c: Record<DebriefSeverity, number> = {
      alarm: 0,
      diag: 0,
      threshold: 0,
      physical: 0,
    };
    for (const e of events) c[e.severity]++;
    return c;
  }, [events]);

  const lapsWithEvents = useMemo(() => {
    const s = new Set<number>();
    for (const e of events) s.add(e.lapIndex);
    return Array.from(s).sort((a, b) => a - b);
  }, [events]);

  const filtered = useMemo(() => {
    if (lapFilter === "all") return events;
    return events.filter((e) => e.lapIndex === lapFilter);
  }, [events, lapFilter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink/20 p-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Totale {events.length} eventi
        </span>
        {(["alarm", "threshold", "diag", "physical"] as DebriefSeverity[]).map((s) => (
          <Badge
            key={s}
            className={`rounded-none font-mono text-[9px] uppercase tracking-widest ${sevBadgeClass(s)}`}
          >
            {SEV_LABEL[s]} · {counts[s]}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 p-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Giro:
        </span>
        <Button
          size="sm"
          variant={lapFilter === "all" ? "default" : "outline"}
          onClick={() => setLapFilter("all")}
          className="h-7 rounded-none font-mono text-[10px] uppercase tracking-widest"
        >
          tutti
        </Button>
        {lapsWithEvents.map((idx) => (
          <Button
            key={idx}
            size="sm"
            variant={lapFilter === idx ? "default" : "outline"}
            onClick={() => setLapFilter(idx)}
            className="h-7 rounded-none font-mono text-[10px] uppercase tracking-widest"
          >
            L{idx}
          </Button>
        ))}
      </div>

      <ScrollArea className="max-h-[480px]">
        {filtered.length === 0 ? (
          <div className="p-6 font-mono text-xs text-muted-foreground">
            Nessun evento per la selezione corrente.
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow className="border-b border-ink/30">
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Sev</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Lap</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">t Start</TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">Dur (s)</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Channel</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Cat</TableHead>
                <TableHead className="text-right font-mono text-[10px] uppercase tracking-widest text-foreground">Peak</TableHead>
                <TableHead className="font-mono text-[10px] uppercase tracking-widest text-foreground">Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e, i) => (
                <TableRow key={e.id} className={`border-b border-ink/10 ${i % 2 ? "bg-muted/40" : ""}`}>
                  <TableCell>
                    <Badge className={`rounded-none font-mono text-[9px] uppercase tracking-widest ${sevBadgeClass(e.severity)}`}>
                      {SEV_LABEL[e.severity]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">L{e.lapIndex}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">{fmtTime(e.tStart)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{e.durationS.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-xs">{e.channelName}</TableCell>
                  <TableCell className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{e.category}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{fmtNum(e.peakValue)}</TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {e.thresholdLabel || e.message || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ScrollArea>
    </div>
  );
}
