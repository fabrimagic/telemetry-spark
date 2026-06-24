import { useMemo, useState } from "react";
import type { Channel, LdFile } from "@/lib/ld/types";
import { downsampleChannel } from "@/lib/ld/downsample";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Brush,
} from "recharts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ViewMode } from "./SessionBar";

const COLORS = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];

const MAX_POINTS = 2000;

interface Props {
  files: LdFile[];
  selected: Channel[];
  mode: ViewMode;
  refLap: { fileIdx: number; lapIdx: number };
}

export function ChartArea({ files, selected, mode, refLap }: Props) {
  const [xAxis, setXAxis] = useState<"time" | "distance">("time");
  const [normalize, setNormalize] = useState(false);

  const lapDist = useMemo(() => {
    const f = files[0];
    return f?.channels.find((c) => c.name.toLowerCase() === "lap distance");
  }, [files]);

  if (selected.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Seleziona uno o più canali dalla barra laterale per iniziare.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-4 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Asse X</Label>
          <ToggleGroup
            type="single"
            size="sm"
            value={xAxis}
            onValueChange={(v) => v && setXAxis(v as "time" | "distance")}
            variant="outline"
          >
            <ToggleGroupItem value="time">Tempo (s)</ToggleGroupItem>
            <ToggleGroupItem value="distance" disabled={!lapDist}>
              Distanza (m)
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="norm" checked={normalize} onCheckedChange={setNormalize} />
          <Label htmlFor="norm" className="text-xs">Normalizza (0–1)</Label>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {mode === "compare"
          ? selected.map((ch) => (
              <CompareChart key={ch.name} files={files} channelName={ch.name} normalize={normalize} />
            ))
          : (
            <MultiChannelChart
              file={files[refLap.fileIdx] ?? files[0]}
              channels={selected}
              xAxis={xAxis}
              normalize={normalize}
              lapDist={lapDist}
            />
          )}
      </div>
    </div>
  );
}

interface MultiProps {
  file: LdFile;
  channels: Channel[];
  xAxis: "time" | "distance";
  normalize: boolean;
  lapDist?: Channel;
}

function MultiChannelChart({ file, channels, xAxis, normalize, lapDist }: MultiProps) {
  const data = useMemo(() => {
    // Build a unified data array: index by row = sample of densest channel.
    // Simple approach: downsample each channel independently to MAX_POINTS,
    // then resample on a shared x axis = densest channel's x.
    const series = channels.map((c) => {
      const pts = downsampleChannel(c.values, c.freq, MAX_POINTS);
      const yScale = normalize && c.max > c.min ? 1 / (c.max - c.min) : 1;
      const yShift = normalize ? -c.min : 0;
      return {
        channel: c,
        points: pts.map((p) => ({ x: p.x, y: (p.y + yShift) * yScale })),
      };
    });

    // Collect all x values, sort & merge
    const xs = new Set<number>();
    series.forEach((s) => s.points.forEach((p) => xs.add(p.x)));
    const sortedX = Array.from(xs).sort((a, b) => a - b);

    // For each sorted x, binary-search nearest in each series
    return sortedX.map((x) => {
      const row: Record<string, number> = { x };
      series.forEach((s, i) => {
        const p = nearest(s.points, x);
        if (p) row[`c${i}`] = p.y;
      });
      return row;
    });
  }, [channels, normalize]);

  // For distance axis, we'd need to remap — kept simple: time only for multi.
  const _ = xAxis;
  const __ = lapDist;
  void _; void __;

  return (
    <div className="h-[500px] w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="x"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => (typeof v === "number" ? v.toFixed(1) : String(v))}
            label={{ value: "Tempo (s)", position: "insideBottom", offset: -10 }}
          />
          <YAxis />
          <Tooltip
            labelFormatter={(v) => `t = ${Number(v).toFixed(3)} s`}
            formatter={(value, name, item) => {
              const idx = Number(String(item.dataKey).replace("c", ""));
              const c = channels[idx];
              return [
                `${Number(value).toFixed(3)} ${c?.unit ?? ""}`.trim(),
                c?.name ?? String(name),
              ];
            }}
          />
          <Legend formatter={(_v, _entry, idx) => channels[idx as number]?.name ?? ""} />
          {channels.map((c, i) => (
            <Line
              key={c.name}
              type="monotone"
              dataKey={`c${i}`}
              stroke={COLORS[i % COLORS.length]}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
          <Brush dataKey="x" height={20} stroke="#888" />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        File: {file.fileName} — {channels.length} canale/i, decimazione visiva a ~{MAX_POINTS} punti.
      </p>
    </div>
  );
}

interface CompareProps {
  files: LdFile[];
  channelName: string;
  normalize: boolean;
}

function CompareChart({ files, channelName, normalize }: CompareProps) {
  const data = useMemo(() => {
    const series: { label: string; points: { x: number; y: number }[] }[] = [];
    files.forEach((f) => {
      const ch = f.channels.find((c) => c.name === channelName);
      if (!ch || ch.empty) return;
      f.laps.forEach((lap) => {
        const startIdx = Math.floor(lap.tStart * ch.freq);
        const endIdx = Math.min(ch.nSamples, Math.floor(lap.tEnd * ch.freq));
        const slice = ch.values.subarray(startIdx, endIdx);
        const pts = downsampleChannel(slice, ch.freq, MAX_POINTS).map((p) => ({
          x: p.x, // seconds from lap start (subarray restarts at 0)
          y: normalize && ch.max > ch.min ? (p.y - ch.min) / (ch.max - ch.min) : p.y,
        }));
        series.push({ label: `${f.fileName} G${lap.index}`, points: pts });
      });
    });
    const xs = new Set<number>();
    series.forEach((s) => s.points.forEach((p) => xs.add(p.x)));
    const sortedX = Array.from(xs).sort((a, b) => a - b);
    return {
      data: sortedX.map((x) => {
        const row: Record<string, number> = { x };
        series.forEach((s, i) => {
          const p = nearest(s.points, x);
          if (p) row[`s${i}`] = p.y;
        });
        return row;
      }),
      series,
    };
  }, [files, channelName, normalize]);

  return (
    <div className="mb-6">
      <h4 className="mb-2 text-sm font-semibold">{channelName}</h4>
      <div className="h-[320px] w-full">
        <ResponsiveContainer>
          <LineChart data={data.data} margin={{ top: 10, right: 30, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => (typeof v === "number" ? v.toFixed(1) : String(v))}
            />
            <YAxis />
            <Tooltip />
            <Legend formatter={(_v, _e, i) => data.series[i as number]?.label ?? ""} />
            {data.series.map((s, i) => (
              <Line
                key={s.label}
                type="monotone"
                dataKey={`s${i}`}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function nearest(points: { x: number; y: number }[], x: number) {
  if (points.length === 0) return null;
  // Binary search
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  const a = points[Math.max(0, lo - 1)];
  const b = points[lo];
  return Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b;
}
