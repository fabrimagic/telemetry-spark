import type { LdFile, Lap } from "@/lib/ld/types";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export type ViewMode = "single" | "compare" | "all";

interface Props {
  files: LdFile[];
  mode: ViewMode;
  onModeChange: (m: ViewMode) => void;
  refLap: { fileIdx: number; lapIdx: number };
  onRefLapChange: (v: { fileIdx: number; lapIdx: number }) => void;
  onReset: () => void;
}

function formatLapTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(3);
  return `${m}:${sec.padStart(6, "0")}`;
}

export function SessionBar({ files, mode, onModeChange, refLap, onRefLapChange, onReset }: Props) {
  const primary = files[0];
  const totalChannels = files.reduce((acc, f) => acc + f.channels.length, 0);
  const totalLaps = files.reduce((acc, f) => acc + f.laps.length, 0);

  const allLaps: { fileIdx: number; lapIdx: number; lap: Lap; label: string }[] = [];
  files.forEach((f, fi) => {
    f.laps.forEach((l, li) => {
      allLaps.push({
        fileIdx: fi,
        lapIdx: li,
        lap: l,
        label: `${f.fileName} · Giro ${l.index} — ${formatLapTime(l.duration)}`,
      });
    });
  });

  return (
    <div className="border-b bg-card">
      <div className="flex flex-wrap items-center gap-4 px-4 py-3">
        <div className="flex-1 min-w-[280px]">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">{primary?.meta.car ?? "Vettura n/d"}</span>
            <span className="text-muted-foreground">·</span>
            <span>{primary?.meta.track ?? "Pista n/d"}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {primary?.meta.date} {primary?.meta.time}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Device: {primary?.meta.device || "n/d"}</Badge>
            <Badge variant="secondary">{totalChannels} canali</Badge>
            <Badge variant="secondary">{totalLaps} giri</Badge>
            <Badge variant="secondary">{files.length} file</Badge>
            {primary?.meta.fastestLap && (
              <Badge variant="secondary">
                Giro veloce: {primary.meta.fastestLap}
                {primary.meta.fastestTime ? ` (${primary.meta.fastestTime})` : ""}
              </Badge>
            )}
          </div>
        </div>

        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && onModeChange(v as ViewMode)}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="single">Giro singolo</ToggleGroupItem>
          <ToggleGroupItem value="compare">Confronto giri</ToggleGroupItem>
          <ToggleGroupItem value="all">Tutti i giri</ToggleGroupItem>
        </ToggleGroup>

        <Select
          value={`${refLap.fileIdx}:${refLap.lapIdx}`}
          onValueChange={(v) => {
            const [fi, li] = v.split(":").map(Number);
            onRefLapChange({ fileIdx: fi, lapIdx: li });
          }}
        >
          <SelectTrigger className="w-[320px]">
            <SelectValue placeholder="Giro di riferimento" />
          </SelectTrigger>
          <SelectContent>
            {allLaps.map((l) => (
              <SelectItem key={`${l.fileIdx}:${l.lapIdx}`} value={`${l.fileIdx}:${l.lapIdx}`}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button size="sm" variant="outline" onClick={onReset}>
          Nuovo file
        </Button>
      </div>
    </div>
  );
}
