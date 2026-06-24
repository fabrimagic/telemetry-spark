// MoTeC .ld binary parser — follows the spec in plan/spec exactly.
// Pure function: takes ArrayBuffer + progress callback, returns LdFile (without fileName).

import type { Channel, LdFile, SessionMeta } from "./types";
import { getOverride } from "./channelOverrides";
import { categorize } from "./categorize";
import { segmentLaps } from "./laps";

export class LdParseError extends Error {}

function readCString(view: DataView, off: number, maxLen: number): string {
  let s = "";
  for (let i = 0; i < maxLen; i++) {
    const c = view.getUint8(off + i);
    if (c === 0) break;
    if (c >= 32 && c < 127) s += String.fromCharCode(c);
  }
  return s.trim();
}

export interface ParseOptions {
  onProgress?: (pct: number, stage: string) => void;
}

export function parseLd(buf: ArrayBuffer, opts: ParseOptions = {}): Omit<LdFile, "fileName"> {
  if (buf.byteLength < 0x100) {
    throw new LdParseError("File too small to be a valid .ld");
  }
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  const firstDescPtr = view.getUint32(0x08, true);
  const dataBlockPtr = view.getUint32(0x0c, true);

  if (
    firstDescPtr === 0 ||
    firstDescPtr >= buf.byteLength ||
    dataBlockPtr === 0 ||
    dataBlockPtr >= buf.byteLength
  ) {
    throw new LdParseError("Invalid .ld header (descriptor / data pointers out of range)");
  }

  const device = readCString(view, 0x4a, 8);
  const date = readCString(view, 0x5e, 16);
  const time = readCString(view, 0x7c, 16);

  // Scan header window for known tokens (car / track) — best-effort.
  const headerText = new TextDecoder("latin1").decode(u8.subarray(0, Math.min(0x500, buf.byteLength)));
  const knownCars = ["GT3R", "GT3", "GT4", "LMP", "F1", "Porsche", "Ferrari", "BMW", "AMG"];
  const knownTracks = ["Misano", "Monza", "Imola", "Mugello", "Spa", "Nürburgring", "Vallelunga", "Barcelona"];
  let car: string | undefined;
  let track: string | undefined;
  for (const t of knownCars) if (headerText.includes(t)) { car = t; break; }
  for (const t of knownTracks) if (headerText.includes(t)) { track = t; break; }

  opts.onProgress?.(5, "Header letto");

  // Walk descriptor linked list.
  const descriptors: number[] = [];
  const visited = new Set<number>();
  let ptr = firstDescPtr;
  let safety = 0;
  while (ptr !== 0 && ptr + 80 <= buf.byteLength && !visited.has(ptr)) {
    visited.add(ptr);
    descriptors.push(ptr);
    const next = view.getUint32(ptr + 4, true);
    ptr = next;
    if (++safety > 5000) break; // hard cap
  }

  if (descriptors.length === 0) {
    throw new LdParseError("No channel descriptors found");
  }

  opts.onProgress?.(15, `Trovati ${descriptors.length} descrittori`);

  const channels: Channel[] = [];
  const total = descriptors.length;

  for (let i = 0; i < total; i++) {
    const dPtr = descriptors[i];
    const dataPtr = view.getUint32(dPtr + 8, true);
    const nSamples = view.getUint32(dPtr + 12, true);
    const size = view.getUint16(dPtr + 20, true);
    const freq = view.getUint16(dPtr + 22, true) || 1;
    const shift = view.getInt16(dPtr + 24, true);
    const mult = view.getInt16(dPtr + 26, true);
    const scale = view.getInt16(dPtr + 28, true);
    const dec = view.getInt16(dPtr + 30, true);
    const name = readCString(view, dPtr + 32, 32);
    const unit = readCString(view, dPtr + 64, 12);

    const bytesNeeded = nSamples * (size === 4 ? 4 : 2);
    const valid =
      dataPtr > 0 &&
      nSamples > 0 &&
      dataPtr + bytesNeeded <= buf.byteLength;

    const values = new Float32Array(valid ? nSamples : 0);

    if (valid) {
      const denom = Math.pow(10, dec);
      const safeMult = mult === 0 ? 1 : mult;
      const safeScale = scale === 0 ? 1 : scale;
      const ovr = getOverride(name, mult);
      // Read raw as typed array (aligned views: copy bytes for safety since dataPtr alignment is not guaranteed).
      if (size === 4) {
        const tmp = new ArrayBuffer(nSamples * 4);
        new Uint8Array(tmp).set(u8.subarray(dataPtr, dataPtr + nSamples * 4));
        const raw = new Int32Array(tmp);
        for (let j = 0; j < nSamples; j++) {
          values[j] = ((raw[j] * safeScale) / safeMult / denom + shift) * ovr.factor;
        }
      } else {
        const tmp = new ArrayBuffer(nSamples * 2);
        new Uint8Array(tmp).set(u8.subarray(dataPtr, dataPtr + nSamples * 2));
        const raw = new Int16Array(tmp);
        for (let j = 0; j < nSamples; j++) {
          values[j] = ((raw[j] * safeScale) / safeMult / denom + shift) * ovr.factor;
        }
      }

      // B2: for channels where negative values are NOT physically plausible
      // (distances, times, counters, lap numbers, busy flags), exclude
      // sentinel samples (<= -1) from min/max/avg.
      // Lap Speed is additionally a sparse end-of-lap channel: most samples
      // are 0 placeholders; exclude them so stats reflect the few real values.
      const filterSentinel = isSentinelFiltered(name);
      const filterZeros = /^lap\s*speed$/i.test(name);
      let min = Infinity, max = -Infinity, sum = 0, cnt = 0;
      for (let j = 0; j < nSamples; j++) {
        const v = values[j];
        if (filterSentinel && v <= -1) continue;
        if (filterZeros && v === 0) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v; cnt++;
      }
      if (cnt === 0) { min = NaN; max = NaN; }

      channels.push({
        idx: i,
        name: name || `Channel ${i}`,
        unit,
        freq,
        nSamples,
        size,
        shift,
        mult,
        scale,
        dec,
        values,
        min,
        max,
        avg: cnt > 0 ? sum / cnt : NaN,
        badges: getOverride(name, mult).badges,
        category: categorize(name),
        empty: false,
      });
    } else {
      channels.push({
        idx: i,
        name: name || `Channel ${i}`,
        unit,
        freq,
        nSamples: 0,
        size,
        shift,
        mult,
        scale,
        dec,
        values,
        min: NaN,
        max: NaN,
        avg: NaN,
        badges: getOverride(name, mult).badges,
        category: categorize(name),
        empty: true,
      });
    }

    if (i % 16 === 0) {
      opts.onProgress?.(15 + Math.round((i / total) * 75), `Canale ${i + 1}/${total}`);
    }
  }

  opts.onProgress?.(92, "Segmentazione giri");
  const laps = segmentLaps(channels);

  // B3: for per-lap reset channels (Lap Distance, Lap Time) the raw series
  // may span multiple laps; recompute stats per-lap so max reflects a single
  // lap rather than a concatenated/cumulative series.
  recomputePerLapStats(channels);

  const meta: SessionMeta = { device, date, time, car, track };

  opts.onProgress?.(100, "Completato");

  return {
    meta,
    channels,
    laps,
    byteLength: buf.byteLength,
  };
}

/**
 * Channels where negative values (notably -1) are sentinel "no data" markers
 * and must be excluded from min/max/avg. Excludes channels where negatives
 * are physically legitimate (accel, yaw, gain/loss, steering, temperatures).
 */
function isSentinelFiltered(name: string): boolean {
  const n = name.toLowerCase();
  if (/(yaw|acc|accel|gain|loss|steer|temp|gyro|gradient|delta)/.test(n)) return false;
  return /(distance|time|count|number|busy|lap\s*speed|fuel|odo)/.test(n);
}

/**
 * Recompute min/max/avg for "Lap Distance" per-lap.
 * The raw series may either reset at each lap (then per-lap value = max window)
 * or accumulate across laps (then per-lap value = max-min within window).
 * Lap windows are derived from "Lap Number" changes when available, else
 * by drop detection on the channel itself.
 */
function recomputePerLapStats(channels: Channel[]) {
  const lapNum = channels.find((c) => c.name.toLowerCase() === "lap number");
  for (const c of channels) {
    if (c.empty || c.nSamples === 0) continue;
    if (c.name.toLowerCase() !== "lap distance") continue;

    // Build per-lap [start,end) sample windows in this channel's own index space.
    const windows: Array<[number, number]> = [];
    if (lapNum && lapNum.nSamples > 1 && lapNum.freq > 0) {
      const ratio = c.freq / lapNum.freq;
      let lapStart = 0;
      let prevLap = Math.round(lapNum.values[0]);
      for (let i = 1; i < lapNum.nSamples; i++) {
        const v = Math.round(lapNum.values[i]);
        if (v !== prevLap) {
          const endIdx = Math.min(c.nSamples, Math.round(i * ratio));
          if (endIdx > lapStart) windows.push([lapStart, endIdx]);
          lapStart = endIdx;
          prevLap = v;
        }
      }
      if (lapStart < c.nSamples) windows.push([lapStart, c.nSamples]);
    } else {
      // Fallback: detect resets in the channel itself (sharp drops).
      let segStart = 0;
      for (let i = 1; i < c.nSamples; i++) {
        if (c.values[i - 1] - c.values[i] > 50) {
          if (i > segStart) windows.push([segStart, i]);
          segStart = i;
        }
      }
      if (segStart < c.nSamples) windows.push([segStart, c.nSamples]);
    }

    if (windows.length === 0) continue;

    let bestMax = -Infinity, bestMin = Infinity, sumPerLap = 0, lapCnt = 0;
    for (const [a, b] of windows) {
      let wMin = Infinity, wMax = -Infinity, valid = 0;
      for (let j = a; j < b; j++) {
        const v = c.values[j];
        if (v <= -1) continue;
        if (v < wMin) wMin = v;
        if (v > wMax) wMax = v;
        valid++;
      }
      if (valid === 0) continue;
      // Per-lap distance covered: handles both reset (wMin≈0) and cumulative cases.
      const lapDist = wMax - wMin;
      if (lapDist > bestMax) bestMax = lapDist;
      if (lapDist < bestMin) bestMin = lapDist;
      sumPerLap += lapDist;
      lapCnt++;
    }
    if (lapCnt > 0) {
      c.min = bestMin;
      c.max = bestMax;
      c.avg = sumPerLap / lapCnt;
    }
  }
}
