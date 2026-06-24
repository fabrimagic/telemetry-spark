// Lap segmentation aligned to MoTeC session numbering.
//
// Primary source: the "Lap Number" channel, which carries an absolute
// car-side counter. A real lap boundary is recognised ONLY when the channel
// transitions to a positive value that is exactly one unit greater than the
// last valid number observed. Transitions to the sentinel -1, repetitions of
// the same value, and non-unit jumps are ignored as boundaries (time keeps
// flowing through them; they do not start a new real lap).
//
// The session-visible lap index is a 1..N progressive number assigned in
// order to the real boundaries found, matching the numbering used by the
// .ldx and by the Overview. The absolute car-side number is preserved on the
// Lap object as `absoluteIndex` for reference / debugging.
//
// Fallback: when "Lap Number" is unavailable, fall back to "Lap Distance"
// resets (sharp decrease).

import type { Channel, Lap } from "./types";

function findChannel(channels: Channel[], target: string): Channel | undefined {
  const t = target.toLowerCase();
  return channels.find((c) => c.name.toLowerCase() === t);
}

export function segmentLaps(channels: Channel[]): Lap[] {
  const lapNum = findChannel(channels, "Lap Number");
  const lapDist = findChannel(channels, "Lap Distance");

  if (lapNum && lapNum.nSamples > 1) {
    return segmentFromLapNumber(lapNum);
  }
  if (lapDist && lapDist.nSamples > 1) {
    return segmentFromLapDistance(lapDist);
  }
  // No usable source: a single whole-file segment, on the first available channel.
  const src = channels[0];
  if (!src) return [];
  const freq = src.freq || 1;
  const totalT = src.nSamples / freq;
  return totalT > 0
    ? [{ index: 1, tStart: 0, tEnd: totalT, duration: totalT }]
    : [];
}

/* ----- Lap Number based segmentation (+1 rule) ----- */
function segmentFromLapNumber(lapNum: Channel): Lap[] {
  const freq = lapNum.freq || 1;
  const totalT = lapNum.nSamples / freq;

  // Boundaries: sample index + absolute lap number entered at that boundary.
  const boundaries: { idx: number; absolute: number }[] = [];
  let lastValid: number | undefined; // last positive lap number observed
  let prev = NaN;

  for (let i = 0; i < lapNum.nSamples; i++) {
    const raw = lapNum.values[i];
    if (!Number.isFinite(raw)) {
      prev = raw;
      continue;
    }
    const v = Math.round(raw);
    if (i === 0) {
      if (v > 0) lastValid = v;
      prev = v;
      continue;
    }
    const prevRounded = Number.isFinite(prev) ? Math.round(prev) : NaN;
    if (v !== prevRounded) {
      // transition
      if (v > 0) {
        if (lastValid === undefined) {
          // first positive value ever — establish baseline, no boundary emitted
          lastValid = v;
        } else if (v === lastValid + 1) {
          // real lap boundary
          boundaries.push({ idx: i, absolute: v });
          lastValid = v;
        }
        // non-unit positive jumps and repetitions are ignored
      }
      // transitions to -1 / non-finite are ignored as boundaries
    }
    prev = v;
  }

  const laps: Lap[] = [];
  if (boundaries.length === 0) {
    // No clean +1 transitions: emit a single segment so the rest of the app keeps working.
    if (totalT > 0) {
      laps.push({ index: 1, tStart: 0, tEnd: totalT, duration: totalT });
    }
    return laps;
  }

  // Lap k spans from boundary k to boundary k+1.
  // Optional opening segment from t=0 to first boundary, if material:
  // we drop it because it is, by definition, before the first real lap completion.
  for (let k = 0; k < boundaries.length - 1; k++) {
    const tStart = boundaries[k].idx / freq;
    const tEnd = boundaries[k + 1].idx / freq;
    laps.push({
      index: laps.length + 1,
      tStart,
      tEnd,
      duration: tEnd - tStart,
      absoluteIndex: boundaries[k].absolute,
    });
  }
  // Trailing lap from last boundary to end of file.
  {
    const tStart = boundaries[boundaries.length - 1].idx / freq;
    const tEnd = totalT;
    if (tEnd > tStart) {
      laps.push({
        index: laps.length + 1,
        tStart,
        tEnd,
        duration: tEnd - tStart,
        absoluteIndex: boundaries[boundaries.length - 1].absolute,
      });
    }
  }
  return laps;
}

/* ----- Lap Distance fallback ----- */
function segmentFromLapDistance(lapDist: Channel): Lap[] {
  const freq = lapDist.freq || 1;
  const totalT = lapDist.nSamples / freq;
  const cutsIdx: number[] = [];
  let prev = lapDist.values[0];
  for (let i = 1; i < lapDist.nSamples; i++) {
    const v = lapDist.values[i];
    if (prev - v > 100) cutsIdx.push(i);
    prev = v;
  }
  const cuts = [0, ...cutsIdx.map((i) => i / freq), totalT];
  const laps: Lap[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const tStart = cuts[i];
    const tEnd = cuts[i + 1];
    if (tEnd - tStart < 1) continue;
    laps.push({ index: laps.length + 1, tStart, tEnd, duration: tEnd - tStart });
  }
  if (laps.length === 0 && totalT > 0) {
    laps.push({ index: 1, tStart: 0, tEnd: totalT, duration: totalT });
  }
  return laps;
}
