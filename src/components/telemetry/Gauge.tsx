// Gauge — half-circle (180°) SVG indicator for a single 0–100 value with
// an explicit physical meaning. Use ONLY for quantities whose 0 and 100
// endpoints carry a real, declarable meaning (e.g. wet-sample fraction,
// fraction of time above the stint-derived high-rpm threshold). No
// invented "optimal zones": the optional `marker` is a reference value
// passed explicitly by the caller and must be declared in the caller's
// own disclaimer. Degrades neutrally when `value` is undefined / NaN:
// shows "—" and an empty arc, never invents a fill.

import { useId } from "react";

export interface GaugeProps {
  /** 0..100 — caller's responsibility to convert from a fraction. */
  value: number | undefined | null;
  /** Short caption rendered under the numeric value. */
  label: string;
  /** Unit suffix for the centre number. Defaults to "%". */
  unit?: string;
  /** Decimals for the centre number. */
  digits?: number;
  /** Optional 0..100 reference marker drawn on the arc (NOT an optimal
   *  zone). Caller declares its meaning in the panel disclaimer. */
  marker?: number;
  /** Optional label for the marker shown beside the value. */
  markerLabel?: string;
  /** Pixel size of the SVG (width). Height is width/2 + padding. */
  size?: number;
  /** Fill colour for the value arc. */
  color?: string;
}

const TAU = Math.PI;

function polar(cx: number, cy: number, r: number, angleRad: number): [number, number] {
  return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
}

/** SVG path for an arc from angle a0 to a1 (radians), both in [PI, 2*PI]
 *  for the upper half-circle (sweeping left→right at the top). */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > TAU ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

export function Gauge({
  value,
  label,
  unit = "%",
  digits = 0,
  marker,
  markerLabel,
  size = 180,
  color = "#22d3ee", // bright cyan, visible against card/track backgrounds
}: GaugeProps) {
  const uid = useId();
  const w = size;
  const cx = w / 2;
  const r = w / 2 - 12;
  const stroke = 12;
  const cy = r + stroke; // top half-circle anchored
  const h = cy + 28; // room for centre text

  // Half-circle goes from angle PI (left) to 2*PI (right) sweeping over the top.
  const A0 = TAU; // PI
  const A1 = 2 * TAU; // 2*PI
  const has = value !== undefined && value !== null && Number.isFinite(value);
  const v = has ? Math.max(0, Math.min(100, value)) : 0;
  const angleAt = (pct: number) => A0 + (A1 - A0) * (pct / 100);
  const aVal = angleAt(v);

  const trackPath = arcPath(cx, cy, r, A0, A1);
  const fillPath = has ? arcPath(cx, cy, r, A0, aVal) : "";

  const showMarker =
    marker !== undefined && Number.isFinite(marker) && marker >= 0 && marker <= 100;
  const aMark = showMarker ? angleAt(marker as number) : 0;
  const [mx1, my1] = showMarker ? polar(cx, cy, r - stroke / 2 - 4, aMark) : [0, 0];
  const [mx2, my2] = showMarker ? polar(cx, cy, r + stroke / 2 + 4, aMark) : [0, 0];

  return (
    <div className="flex flex-col items-center">
      <svg width={w} height={h} role="img" aria-label={`${label}: ${has ? v.toFixed(digits) : "n/d"}${unit}`}>
        <path
          d={trackPath}
          fill="none"
          stroke="hsl(var(--ink) / 0.15)"
          strokeWidth={stroke}
          strokeLinecap="butt"
        />
        {has && (
          <path
            d={fillPath}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="butt"
            id={`gauge-fill-${uid}`}
          />
        )}
        {showMarker && (
          <line
            x1={mx1}
            y1={my1}
            x2={mx2}
            y2={my2}
            stroke="hsl(var(--ink) / 0.7)"
            strokeWidth={2}
          />
        )}
        {/* Endpoints labels */}
        <text
          x={cx - r}
          y={cy + 14}
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize={9}
          fill="hsl(var(--muted-foreground))"
        >
          0{unit}
        </text>
        <text
          x={cx + r}
          y={cy + 14}
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize={9}
          fill="hsl(var(--muted-foreground))"
        >
          100{unit}
        </text>
        {/* Centre value */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontFamily="var(--font-mono, monospace)"
          fontSize={22}
          fill="hsl(var(--ink))"
        >
          {has ? `${v.toFixed(digits)}${unit}` : "—"}
        </text>
      </svg>
      <div className="mt-1 text-center font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {showMarker && markerLabel && (
        <div className="mt-1 text-center font-mono text-[9px] text-muted-foreground">
          riferimento: {markerLabel} ({(marker as number).toFixed(0)}{unit})
        </div>
      )}
    </div>
  );
}
