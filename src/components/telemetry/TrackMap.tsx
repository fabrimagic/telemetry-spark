import { useMemo } from "react";
import type { Lap, LdFile } from "@/lib/ld/types";
import { buildTrackMap } from "@/lib/ld/trackMap";

/**
 * Static SVG drawing of the circuit, built from raw GPS samples of a
 * reference lap. The shape is rendered as a single polyline with a marker
 * on the start/finish line and a small arrow indicating the direction of
 * travel.
 *
 * Falls back to a short message when GPS data is insufficient.
 */
export function TrackMap({ file, refLap }: { file: LdFile; refLap?: Lap | null }) {
  const map = useMemo(() => buildTrackMap(file, refLap ?? null), [file, refLap]);

  if (!map) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Dati GPS insufficienti per disegnare il tracciato (canali "log gps lat/lon" o "gps
        latitude/longitude" mancanti o fuori range).
      </p>
    );
  }

  const { outline, viewBox, startFinish, directionHint, source, sampleCount, lapIndex } = map;
  const pathD = outline.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + " Z";

  // Direction arrow geometry.
  let arrow: { x: number; y: number; angle: number } | null = null;
  if (directionHint) {
    const dx = directionHint.to.x - directionHint.from.x;
    const dy = directionHint.to.y - directionHint.from.y;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    arrow = { x: directionHint.from.x, y: directionHint.from.y, angle };
  }

  return (
    <div className="space-y-2 font-mono">
      <div className="border border-ink/20 bg-card/40 p-2">
        <svg
          viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Track outline"
        >
          {/* Track outline */}
          <path
            d={pathD}
            fill="none"
            stroke="hsl(var(--ink))"
            strokeOpacity={0.75}
            strokeWidth={6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Faint inner highlight to read against dark backgrounds */}
          <path
            d={pathD}
            fill="none"
            stroke="hsl(var(--ink))"
            strokeOpacity={0.15}
            strokeWidth={14}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Start / finish marker */}
          <g>
            <circle
              cx={startFinish.x}
              cy={startFinish.y}
              r={10}
              fill="hsl(var(--race-red))"
              stroke="hsl(var(--card))"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          {/* Direction arrow */}
          {arrow && (
            <g transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}>
              <polygon
                points="0,-7 20,0 0,7"
                fill="hsl(var(--race-red))"
                opacity={0.85}
              />
            </g>
          )}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>sorgente: {source}</span>
        <span>{sampleCount} campioni</span>
        {lapIndex && <span>lap rif. {Math.round(lapIndex.lapLength)} m</span>}
        <span className="text-race-red">● start/finish</span>
      </div>
    </div>
  );
}
