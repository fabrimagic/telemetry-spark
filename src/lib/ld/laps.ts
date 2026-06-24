// Lap segmentation: prefer "Lap Number" change events, fall back to
// "Lap Distance" resets (sharp decrease).

import type { Channel, Lap } from "./types";

function findChannel(channels: Channel[], target: string): Channel | undefined {
  const t = target.toLowerCase();
  return channels.find((c) => c.name.toLowerCase() === t);
}

export function segmentLaps(channels: Channel[]): Lap[] {
  const lapNum = findChannel(channels, "Lap Number");
  const lapDist = findChannel(channels, "Lap Distance");

  // Build boundary sample indices on the source channel's own time axis.
  const boundaries: { src: Channel; sampleIdxs: number[] } = {
    src: lapNum ?? lapDist ?? channels[0],
    sampleIdxs: [],
  };

  if (lapNum && lapNum.nSamples > 1) {
    let prev = lapNum.values[0];
    for (let i = 1; i < lapNum.nSamples; i++) {
      const v = lapNum.values[i];
      if (Math.round(v) !== Math.round(prev)) {
        boundaries.sampleIdxs.push(i);
        prev = v;
      }
    }
  } else if (lapDist && lapDist.nSamples > 1) {
    let prev = lapDist.values[0];
    for (let i = 1; i < lapDist.nSamples; i++) {
      const v = lapDist.values[i];
      if (prev - v > 100 /* meters drop = lap reset */) {
        boundaries.sampleIdxs.push(i);
      }
      prev = v;
    }
  }

  const freq = boundaries.src.freq || 1;
  const totalT = boundaries.src.nSamples / freq;

  // Convert boundary sample indices to seconds.
  const cuts = [0, ...boundaries.sampleIdxs.map((i) => i / freq), totalT];
  const laps: Lap[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const tStart = cuts[i];
    const tEnd = cuts[i + 1];
    if (tEnd - tStart < 1) continue; // ignore micro-segments
    laps.push({
      index: laps.length + 1,
      tStart,
      tEnd,
      duration: tEnd - tStart,
    });
  }

  if (laps.length === 0 && totalT > 0) {
    laps.push({ index: 1, tStart: 0, tEnd: totalT, duration: totalT });
  }
  return laps;
}
