import { useMemo, useRef, useCallback } from "react";
import type { Lap, LdFile } from "@/lib/ld/types";
import { buildTrackMap, type TrackMap as TrackMapData } from "@/lib/ld/trackMap";

export interface TrackAbsMarker {
  d: number;
  durationS: number;
}

export interface TrackSetupMark {
  d: number;
  label: string;
}

interface Props {
  file: LdFile;
  refLap?: Lap | null;
  /** Shared lap-distance cursor (m). null = no cursor. */
  cursorDist?: number | null;
  /** Called when the user hovers / leaves the map. */
  onCursorDistChange?: (d: number | null) => void;
  absMarkers?: TrackAbsMarker[];
  setupMark?: TrackSetupMark | null;
}

export function TrackMap({
  file,
  refLap,
  cursorDist = null,
  onCursorDistChange,
  absMarkers = [],
  setupMark = null,
}: Props) {
  const map = useMemo(() => buildTrackMap(file, refLap ?? null), [file, refLap]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!onCursorDistChange || !map || !map.lapIndex) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const vx = ((e.clientX - rect.left) / rect.width) * map.viewBox.w;
      const vy = ((e.clientY - rect.top) / rect.height) * map.viewBox.h;
      // Nearest sample by Euclidean distance.
      let bestD = Infinity;
      let bestDist: number | null = null;
      const ss = map.lapIndex.samples;
      for (let i = 0; i < ss.length; i++) {
        const dx = ss[i].x - vx;
        const dy = ss[i].y - vy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) {
          bestD = d2;
          bestDist = ss[i].d;
        }
      }
      if (bestDist !== null) onCursorDistChange(bestDist);
    },
    [map, onCursorDistChange],
  );

  const handleLeave = useCallback(() => {
    onCursorDistChange?.(null);
  }, [onCursorDistChange]);

  if (!map) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Dati GPS insufficienti per disegnare il tracciato (canali "log gps lat/lon" o "gps
        latitude/longitude" mancanti o fuori range).
      </p>
    );
  }

  const { outline, viewBox, startFinish, directionHint, source, sampleCount, lapIndex } = map;
  const pathD =
    outline.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") +
    " Z";

  if (!pathD || outline.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        Errore: outline del tracciato vuoto (outline pts: {outline.length}).
      </p>
    );
  }

  // Direction arrow geometry.
  let arrow: { x: number; y: number; angle: number } | null = null;
  if (directionHint) {
    const dx = directionHint.to.x - directionHint.from.x;
    const dy = directionHint.to.y - directionHint.from.y;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    arrow = { x: directionHint.from.x, y: directionHint.from.y, angle };
  }

  const cursorPt =
    cursorDist !== null && lapIndex ? lapIndex.pointAt(cursorDist) : null;
  const setupPt = setupMark && lapIndex ? lapIndex.pointAt(setupMark.d) : null;
  const absPts = lapIndex
    ? absMarkers
        .map((m) => ({ pt: lapIndex.pointAt(m.d), m }))
        .filter((x): x is { pt: { x: number; y: number }; m: TrackAbsMarker } => x.pt !== null)
    : [];

  return (
    <div className="space-y-2 font-mono">
      <div className="border border-ink/20 bg-card/40 p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${viewBox.w} ${viewBox.h}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Track outline"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
          style={{ cursor: onCursorDistChange ? "crosshair" : "default" }}
        >
          {/* Halo */}
          <path
            d={pathD}
            fill="none"
            stroke="#1a1a1a"
            strokeOpacity={0.15}
            strokeWidth={14}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Track outline */}
          <path
            d={pathD}
            fill="none"
            stroke="#1a1a1a"
            strokeOpacity={1}
            strokeWidth={6}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Direction arrow */}
          {arrow && (
            <g transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}>
              <polygon points="0,-7 20,0 0,7" fill="#e62e2e" opacity={0.85} />
            </g>
          )}
          {/* ABS markers (amber) */}
          {absPts.map(({ pt, m }, i) => (
            <g key={`abs-${i}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={7}
                fill="#c97a00"
                fillOpacity={0.85}
                stroke="#ffffff"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`ABS · ${Math.round(m.d)} m · ${m.durationS.toFixed(2)} s`}</title>
              </circle>
            </g>
          ))}
          {/* Setup change marker (diamond, ink) */}
          {setupPt && setupMark && (
            <g transform={`translate(${setupPt.x} ${setupPt.y}) rotate(45)`}>
              <rect
                x={-8}
                y={-8}
                width={16}
                height={16}
                fill="#1a1a1a"
                stroke="#e62e2e"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`Setup · ${setupMark.label} · ${Math.round(setupMark.d)} m`}</title>
              </rect>
            </g>
          )}
          {/* Start / finish */}
          <circle
            cx={startFinish.x}
            cy={startFinish.y}
            r={9}
            fill="#e62e2e"
            stroke="#ffffff"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {/* Cursor marker (on top) */}
          {cursorPt && (
            <g>
              <circle
                cx={cursorPt.x}
                cy={cursorPt.y}
                r={12}
                fill="#e62e2e"
                fillOpacity={0.2}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={cursorPt.x}
                cy={cursorPt.y}
                r={6}
                fill="#e62e2e"
                stroke="#ffffff"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-3 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>sorgente: {source}</span>
        <span>{sampleCount} punti contorno</span>
        {lapIndex && <span>lap rif. {Math.round(lapIndex.lapLength)} m</span>}
        <span className="text-race-red">● start/finish</span>
        {absPts.length > 0 && <span style={{ color: "#c97a00" }}>● abs</span>}
        {setupPt && <span>◆ setup</span>}
        {cursorDist !== null && <span>cursore {Math.round(cursorDist)} m</span>}
      </div>
    </div>
  );
}

// Re-export for callers that want types
export type { TrackMapData };
