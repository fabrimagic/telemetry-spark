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
import { resolveChannel } from "@/lib/ld/channelResolver";

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
  // Prefer the high-resolution (7-decimal) channels; fall back to the
  // 4-decimal "log gps" channels only when the high-res pair is missing.
  const latHi = findChannel(channels, "gps latitude");
  const lonHi = findChannel(channels, "gps longitude");
  if (latHi && lonHi) return { lat: latHi, lon: lonHi, source: "gps latitude/longitude" };
  const latLo = findChannel(channels, "log gps lat");
  const lonLo = findChannel(channels, "log gps lon");
  if (latLo && lonLo) return { lat: latLo, lon: lonLo, source: "log gps lat/lon" };
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
  const latFreq = lat.freq || 0;
  const lonFreq = lon.freq || 0;
  if (latFreq <= 0 || lonFreq <= 0) return null;
  if (lat.values.length === 0 || lon.values.length === 0) return null;

  // 1) Pick a reference lap (caller, or longest-duration as a proxy for a full lap).
  let ref = refLap ?? null;
  if (!ref || !Number.isFinite(ref.tEnd - ref.tStart) || ref.tEnd <= ref.tStart) {
    ref =
      file.laps.length > 0
        ? [...file.laps].sort((a, b) => b.tEnd - b.tStart - (a.tEnd - a.tStart))[0]
        : null;
  }
  if (!ref) return null;
  const tStart = ref.tStart;
  const tEnd = ref.tEnd;
  if (!(tEnd > tStart)) return null;

  // 2) Sample lat/lon at a fixed 5 Hz cadence across the lap window. Each
  //    channel is indexed at its own native frequency: i = round(t * freq).
  const lapDist = findChannel(file.channels, "lap distance");
  const ldFreq = lapDist?.freq ?? 0;
  const ldLen = lapDist?.values.length ?? 0;

  const STEP_S = 0.2; // 5 samples per second
  type Raw = { lat: number; lon: number; t: number; d?: number };
  const raw: Raw[] = [];
  for (let t = tStart; t <= tEnd; t += STEP_S) {
    const iLat = Math.round(t * latFreq);
    const iLon = Math.round(t * lonFreq);
    if (iLat < 0 || iLat >= lat.values.length) continue;
    if (iLon < 0 || iLon >= lon.values.length) continue;
    const la = lat.values[iLat];
    const lo = lon.values[iLon];
    if (!isPlausibleLatLon(la, lo)) continue;
    let d: number | undefined;
    if (lapDist && ldFreq > 0 && ldLen > 0) {
      const j = Math.min(ldLen - 1, Math.max(0, Math.round(t * ldFreq)));
      const dv = lapDist.values[j];
      if (Number.isFinite(dv) && dv >= 0) d = dv;
    }
    raw.push({ lat: la, lon: lo, t, d });
  }
  if (raw.length < 30) return null;

  // 3) Reject residual outliers using the median of the lap samples.
  const lat0 = median(raw.map((r) => r.lat));
  const lon0 = median(raw.map((r) => r.lon));
  const samples = raw.filter(
    (r) => Math.abs(r.lat - lat0) <= DEG_TOL && Math.abs(r.lon - lon0) <= DEG_TOL,
  );
  if (samples.length < 30) return null;

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

  // 6) Lap-distance index, sorted by distance, from the same lap samples
  //    so that pointAt() returns positions exactly on the drawn outline.
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
          let dd = d;
          if (lapLength > 0) {
            dd = ((d % lapLength) + lapLength) % lapLength;
          }
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

  // 7) Direction hint from the first ~1 s of the lap.
  let directionHint: TrackMap["directionHint"];
  if (outline.length > 6) {
    directionHint = { from: outline[0], to: outline[Math.min(outline.length - 1, 5)] };
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
    sampleCount: outline.length,
  };
}
