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
}

function fmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) > 9999 || (Math.abs(n) < 0.01 && n !== 0)) return n.toExponential(2);
  return n.toFixed(3);
}

export function ChannelTable({ channels }: Props) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return channels.filter((c) => !s || c.name.toLowerCase().includes(s));
  }, [channels, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <Input
          placeholder="Filtra canali…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
        />
      </div>
      <ScrollArea className="flex-1">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              <TableHead>Canale</TableHead>
              <TableHead>Unità</TableHead>
              <TableHead className="text-right">Freq</TableHead>
              <TableHead className="text-right">N camp.</TableHead>
              <TableHead className="text-right">Min</TableHead>
              <TableHead className="text-right">Max</TableHead>
              <TableHead className="text-right">Media</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((c) => (
              <TableRow key={c.name}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c.unit || "—"}</TableCell>
                <TableCell className="text-right">{c.freq} Hz</TableCell>
                <TableCell className="text-right">{c.nSamples}</TableCell>
                <TableCell className="text-right">{fmt(c.min)}</TableCell>
                <TableCell className="text-right">{fmt(c.max)}</TableCell>
                <TableCell className="text-right">{fmt(c.avg)}</TableCell>
                <TableCell>{c.category}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {c.empty && <Badge variant="outline" className="text-[10px]">vuoto</Badge>}
                    {c.badges.includes("special") && (
                      <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-0 text-[10px]">
                        speciale
                      </Badge>
                    )}
                    {c.badges.includes("verify") && (
                      <Badge className="bg-yellow-500/20 text-yellow-800 dark:text-yellow-300 border-0 text-[10px]">
                        verificare
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
