/**
 * Track map geometry built from raw GPS samples in the .ld file.
 *
 * The map outline is the GPS trace of a single reference lap, projected with a
 * local equirectangular projection (uniform x/y scale, no shape distortion)
 * and normalised into an SVG viewBox.
 *
 * A by-product is an index that links lap distance (Lap Distance channel) to
 * the corresponding (x, y) point on the projected track. Other modules can
 * use it to map any "function-of-lap-distance" telemetry trace to a physical
 * location on the circuit.
 */
import type { Channel, Lap, LdFile } from "@/lib/ld/types";
import { norm } from "@/lib/ld/sessionDebrief";

export interface Pt {
  x: number;
  y: number;
}

export interface TrackProjection {
  /** Reference latitude (origin) in degrees. */
  lat0: number;
  /** Reference longitude (origin) in degrees. */
  lon0: number;
  /** cos(lat0) — longitude scale correction. */
  cosLat0: number;
  /**
   * Uniform world-to-viewBox scale (same on x and y). Multiply
   * (lon-lon0)*cosLat0*M and (lat-lat0)*M by this scale, where M is a
   * degrees-to-metres factor (cancels out in viewBox space).
   */
  scale: number;
  offsetX: number;
  offsetY: number;
  /** SVG viewBox width / height. */
  width: number;
  height: number;
}

export interface LapDistanceSample {
  d: number;
  x: number;
  y: number;
}

export interface LapDistanceIndex {
  /** Sorted by lap distance. */
  samples: LapDistanceSample[];
  /** Reference lap length in metres (max sampled lap distance). */
  lapLength: number;
  /** Returns the projected (x, y) for a given lap distance, with linear interp. */
  pointAt(d: number): Pt | null;
}

export interface TrackMap {
  /** Projected polyline (ordered) of the reference lap. */
  outline: Pt[];
  /** Start/finish marker (first outline point — lap distance ≈ 0). */
  startFinish: Pt;
  /** Direction marker placed slightly along the outline (for an arrow). */
  directionHint?: { from: Pt; to: Pt };
  /** SVG viewBox dimensions. */
  viewBox: { w: number; h: number };
  projection: TrackProjection;
  /** Lap distance → (x, y) index, if Lap Distance channel is available. */
  lapIndex?: LapDistanceIndex;
  /** Project an arbitrary (lat, lon) into viewBox space. */
  project(lat: number, lon: number): Pt;
  /** Diagnostics for UI / debugging. */
  source: "log gps lat/lon" | "gps latitude/longitude";
  sampleCount: number;
}

/* ===================== Helpers ===================== */

function findChannel(channels: Channel[], normName: string): Channel | undefined {
  return channels.find((c) => norm(c.name) === normName && !c.empty && c.nSamples > 0);
}

function pickGpsChannels(channels: Channel[]):
  | { lat: Channel; lon: Channel; source: TrackMap["source"] }
  | null {
  const lat1 = findChannel(channels, "log gps lat");
  const lon1 = findChannel(channels, "log gps lon");
  if (lat1 && lon1) return { lat: lat1, lon: lon1, source: "log gps lat/lon" };
  const lat2 = findChannel(channels, "gps latitude");
  const lon2 = findChannel(channels, "gps longitude");
  if (lat2 && lon2) return { lat: lat2, lon: lon2, source: "gps latitude/longitude" };
  return null;
}

function isPlausibleLatLon(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  // Drop common sentinels and obviously-invalid values.
  if (lat === 0 || lon === 0) return false;
  if (lat === -1 || lon === -1) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  // The big sentinel buckets observed in raw GPS (≈ ±214) are also covered
  // by the |lon|>180 check above.
  return true;
}

function median(arr: number[]): number {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

/* ===================== Builder ===================== */

const DEG_TOL = 0.05; // ~5 km at mid-latitudes — well outside any single circuit
const DEG_TO_M = 111_320; // mean metres per degree of latitude

/**
 * Build the track-map geometry. Returns null when GPS data is unusable
 * (no GPS channels, no valid samples, or no plausible reference lap).
 *
 * @param refLap optional reference lap; defaults to the longest-by-time lap
 *   in the file (which is usually a complete lap).
 */
export function buildTrackMap(file: LdFile, refLap?: Lap | null): TrackMap | null {
  const picked = pickGpsChannels(file.channels);
  if (!picked) return null;
  const { lat, lon, source } = picked;
  if (lat.values.length === 0 || lon.values.length === 0) return null;

  // 1) Collect plausible samples across the whole stint to compute medians.
  const latFreq = lat.freq || 1;
  const lonFreq = lon.freq || 1;
  const baseFreq = Math.min(latFreq, lonFreq);
  const latStep = Math.max(1, Math.round(latFreq / baseFreq));
  const lonStep = Math.max(1, Math.round(lonFreq / baseFreq));
  const n = Math.min(
    Math.floor(lat.values.length / latStep),
    Math.floor(lon.values.length / lonStep),
  );

  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < n; i++) {
    const la = lat.values[i * latStep];
    const lo = lon.values[i * lonStep];
    if (!isPlausibleLatLon(la, lo)) continue;
    lats.push(la);
    lons.push(lo);
  }
  if (lats.length < 50) return null;

  const lat0 = median(lats);
  const lon0 = median(lons);

  // 2) Pick a reference lap. Prefer the caller's choice, otherwise the
  //    longest-duration lap (best proxy for a complete lap in the file).
  let ref = refLap ?? null;
  if (!ref || !Number.isFinite(ref.tEnd - ref.tStart)) {
    ref =
      file.laps.length > 0
        ? [...file.laps].sort((a, b) => b.tEnd - b.tStart - (a.tEnd - a.tStart))[0]
        : null;
  }
  if (!ref) return null;

  // 3) Extract GPS samples that fall inside the reference lap window,
  //    rejecting anything too far from the session median (residual sentinels).
  const lapDist = findChannel(file.channels, "lap distance");
  const ldFreq = lapDist?.freq ?? 0;
  const ldLen = lapDist?.values.length ?? 0;

  const iStart = Math.max(0, Math.floor(ref.tStart * baseFreq));
  const iEnd = Math.min(n, Math.ceil(ref.tEnd * baseFreq));

  type Raw = { lat: number; lon: number; t: number; d?: number };
  const samples: Raw[] = [];
  for (let i = iStart; i < iEnd; i++) {
    const la = lat.values[i * latStep];
    const lo = lon.values[i * lonStep];
    if (!isPlausibleLatLon(la, lo)) continue;
    if (Math.abs(la - lat0) > DEG_TOL || Math.abs(lo - lon0) > DEG_TOL) continue;
    const t = i / baseFreq;
    let d: number | undefined;
    if (lapDist && ldFreq > 0) {
      const j = Math.min(ldLen - 1, Math.max(0, Math.round(t * ldFreq)));
      const dv = lapDist.values[j];
      if (Number.isFinite(dv) && dv >= 0) d = dv;
    }
    samples.push({ lat: la, lon: lo, t, d });
  }
  if (samples.length < 50) return null;

  // 4) Local equirectangular projection in metres.
  const cosLat0 = Math.cos((lat0 * Math.PI) / 180);
  const worldPts = samples.map((s) => ({
    wx: (s.lon - lon0) * cosLat0 * DEG_TO_M,
    wy: -(s.lat - lat0) * DEG_TO_M, // SVG y grows downwards
    d: s.d,
  }));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of worldPts) {
    if (p.wx < minX) minX = p.wx;
    if (p.wx > maxX) maxX = p.wx;
    if (p.wy < minY) minY = p.wy;
    if (p.wy > maxY) maxY = p.wy;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!Number.isFinite(spanX) || !Number.isFinite(spanY) || spanX <= 0 || spanY <= 0) {
    return null;
  }

  // 5) Fit into a viewBox while preserving aspect ratio.
  const TARGET = 1000;
  const PAD = 24;
  const scale = (TARGET - 2 * PAD) / Math.max(spanX, spanY);
  const width = spanX * scale + 2 * PAD;
  const height = spanY * scale + 2 * PAD;
  const offsetX = PAD - minX * scale;
  const offsetY = PAD - minY * scale;

  const projection: TrackProjection = {
    lat0,
    lon0,
    cosLat0,
    scale,
    offsetX,
    offsetY,
    width,
    height,
  };

  const project = (la: number, lo: number): Pt => ({
    x: (lo - lon0) * cosLat0 * DEG_TO_M * scale + offsetX,
    y: -(la - lat0) * DEG_TO_M * scale + offsetY,
  });

  const outline: Pt[] = worldPts.map((p) => ({
    x: p.wx * scale + offsetX,
    y: p.wy * scale + offsetY,
  }));

  // 6) Lap-distance index (sorted, monotonic-ish along the lap).
  let lapIndex: LapDistanceIndex | undefined;
  if (lapDist) {
    const indexed: LapDistanceSample[] = [];
    for (let i = 0; i < worldPts.length; i++) {
      const d = worldPts[i].d;
      if (d === undefined) continue;
      indexed.push({ d, x: outline[i].x, y: outline[i].y });
    }
    if (indexed.length >= 10) {
      indexed.sort((a, b) => a.d - b.d);
      const lapLength = indexed[indexed.length - 1].d;
      lapIndex = {
        samples: indexed,
        lapLength,
        pointAt(d: number): Pt | null {
          if (!Number.isFinite(d) || indexed.length === 0) return null;
          // Wrap d into [0, lapLength] if a lap length is meaningful.
          let dd = d;
          if (lapLength > 0) {
            dd = ((d % lapLength) + lapLength) % lapLength;
          }
          // Binary search.
          let lo = 0;
          let hi = indexed.length - 1;
          if (dd <= indexed[0].d) return { x: indexed[0].x, y: indexed[0].y };
          if (dd >= indexed[hi].d) return { x: indexed[hi].x, y: indexed[hi].y };
          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (indexed[mid].d <= dd) lo = mid;
            else hi = mid;
          }
          const a = indexed[lo];
          const b = indexed[hi];
          const span = b.d - a.d;
          const t = span > 0 ? (dd - a.d) / span : 0;
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        },
      };
    }
  }

  // 7) Direction hint: vector from first outline point to a point a short
  //    distance along the trace.
  let directionHint: TrackMap["directionHint"];
  if (outline.length > 20) {
    directionHint = { from: outline[0], to: outline[Math.min(outline.length - 1, 20)] };
  }

  return {
    outline,
    startFinish: outline[0],
    directionHint,
    viewBox: { w: width, h: height },
    projection,
    lapIndex,
    project,
    source,
    sampleCount: samples.length,
  };
}
