import { useMemo, useState } from "react";
import type { Channel, ChannelCategory } from "@/lib/ld/types";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  channels: Channel[];
  selected: Set<string>;
  onToggle: (name: string) => void;
}

const CATEGORY_ORDER: ChannelCategory[] = [
  "Motore",
  "Freni",
  "Gomme",
  "Sospensioni",
  "Dinamica",
  "GPS",
  "Giro",
  "Elettronica",
  "Ambiente",
  "Altro",
];

export function ChannelSidebar({ channels, selected, onToggle }: Props) {
  const [query, setQuery] = useState("");
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(CATEGORY_ORDER));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => !q || c.name.toLowerCase().includes(q));
  }, [channels, query]);

  const byCat = useMemo(() => {
    const m = new Map<ChannelCategory, Channel[]>();
    for (const c of filtered) {
      const list = m.get(c.category) ?? [];
      list.push(c);
      m.set(c.category, list);
    }
    return m;
  }, [filtered]);

  const toggleCat = (cat: string) => {
    const next = new Set(openCats);
    next.has(cat) ? next.delete(cat) : next.add(cat);
    setOpenCats(next);
  };

  return (
    <aside className="flex h-full w-72 flex-col border-r bg-sidebar">
      <div className="border-b p-3">
        <Input
          placeholder="Cerca canale…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {selected.size} di {channels.length} selezionati
        </p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {CATEGORY_ORDER.map((cat) => {
            const list = byCat.get(cat);
            if (!list || list.length === 0) return null;
            const open = openCats.has(cat);
            return (
              <Collapsible key={cat} open={open} onOpenChange={() => toggleCat(cat)}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm font-semibold hover:bg-accent">
                  <span>{cat} <span className="text-muted-foreground font-normal">({list.length})</span></span>
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-2 mt-1 space-y-0.5">
                    {list.map((c) => (
                      <label
                        key={c.name}
                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-accent"
                      >
                        <Checkbox
                          checked={selected.has(c.name)}
                          onCheckedChange={() => onToggle(c.name)}
                          className="mt-0.5"
                          disabled={c.empty}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{c.name}</div>
                          <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                            <span>{c.unit || "—"}</span>
                            <span>·</span>
                            <span>{c.freq} Hz</span>
                            {c.empty && <Badge variant="outline" className="h-4 px-1 text-[9px]">vuoto</Badge>}
                            {c.badges.includes("special") && (
                              <Badge className="h-4 px-1 text-[9px] bg-blue-500/15 text-blue-700 dark:text-blue-300 border-0">
                                conv. speciale
                              </Badge>
                            )}
                            {c.badges.includes("verify") && (
                              <Badge className="h-4 px-1 text-[9px] bg-yellow-500/20 text-yellow-800 dark:text-yellow-300 border-0">
                                scala da verificare
                              </Badge>
                            )}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
