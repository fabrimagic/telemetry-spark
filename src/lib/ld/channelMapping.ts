// Channel Mapping — diagnostic engine.
//
// Purpose: support the onboarding of a new car / firmware / .ld file.
// For the currently loaded file we report which logical keys are resolved
// (and on which physical channel), which logical keys remain unresolved,
// and which physical channels are NOT consumed by any logical key (i.e.
// candidates for new aliases in `channelResolver.ts`).
//
// Discipline: this module REUSES `resolveChannel` from the central resolver
// and does NOT reimplement matching. It exposes only verifiable facts —
// "this physical channel matches this logical key" — and never infers
// semantics on its own. No verdicts, no inferences.
//
// Parsers are not touched.

import {
  ALL_LOGICAL_KEYS,
  describePatterns,
  isChannelUsable,
  resolveChannel,
  type LogicalKey,
} from "@/lib/ld/channelResolver";
import type { Channel, ChannelCategory, LdFile } from "@/lib/ld/types";

export interface ResolvedLogicalEntry {
  key: LogicalKey;
  channelName: string;
  freq: number;
  unit: string;
  nSamples: number;
}

export interface UnresolvedLogicalEntry {
  key: LogicalKey;
  /** Human-readable list of patterns the resolver tries (diagnostic hint). */
  patterns: string[];
}

/**
 * Classification of an unmapped physical channel based on cached parser stats
 * (min/max/avg/nSamples/empty). No heavy recomputation, no invented thresholds.
 *
 * - "data":     min != max with finite values → real signal, candidate for a
 *               new alias in the resolver.
 * - "constant": has samples but min == max (within FLAT_TOL) or any of
 *               min/max/avg is NaN → flat / stuck / sentinel; mapping it
 *               would not add usable signal.
 * - "empty":    no samples at all (empty===true or nSamples===0). Normally
 *               filtered out upstream by `isChannelUsable`, kept here for
 *               completeness if a caller passes raw channels.
 *
 * Limit (declared): we cannot detect "populated but mostly null" (e.g. slip
 * channels that are 0 for 99.7% of samples) from min/max alone, because a
 * single non-zero sample would still make min != max. Detecting that would
 * require an O(n) pass that is not currently cached on Channel, so it is
 * intentionally out of scope here.
 */
export type UnmappedStatus = "data" | "constant" | "empty";

/** Tolerance for declaring min == max (covers float-quantisation noise only). */
const FLAT_TOL = 1e-9;

export interface UnmappedChannelEntry {
  name: string;
  freq: number;
  unit: string;
  nSamples: number;
  category: ChannelCategory;
  status: UnmappedStatus;
  min: number;
  max: number;
  avg: number;
}

export interface ChannelMappingReport {
  resolved: ResolvedLogicalEntry[];
  unresolved: UnresolvedLogicalEntry[];
  unmapped: UnmappedChannelEntry[];
  totals: {
    logicalKeys: number;
    resolvedKeys: number;
    usableChannels: number;
    mappedChannels: number;
    unmappedChannels: number;
    unmappedWithData: number;
    unmappedConstant: number;
    unmappedEmpty: number;
  };
}

function classifyUnmapped(c: Channel): UnmappedStatus {
  if (c.empty || c.nSamples === 0) return "empty";
  if (!Number.isFinite(c.min) || !Number.isFinite(c.max) || !Number.isFinite(c.avg)) {
    return "constant";
  }
  if (Math.abs(c.max - c.min) < FLAT_TOL) return "constant";
  return "data";
}


export function buildChannelMapping(file: LdFile): ChannelMappingReport {
  const channels = file.channels;

  const resolved: ResolvedLogicalEntry[] = [];
  const unresolved: UnresolvedLogicalEntry[] = [];
  // Track which physical channels have been claimed by at least one key.
  const mappedIdx = new Set<number>();

  for (const key of ALL_LOGICAL_KEYS) {
    const ch = resolveChannel(channels, key);
    if (ch) {
      resolved.push({
        key,
        channelName: ch.name,
        freq: ch.freq,
        unit: ch.unit,
        nSamples: ch.nSamples,
      });
      mappedIdx.add(ch.idx);
    } else {
      unresolved.push({ key, patterns: describePatterns(key) });
    }
  }

  // For classification we consider ALL non-mapped channels (including empty
  // and constant ones), so the engineer sees the full picture. `isChannelUsable`
  // is still used for the "usable" total.
  const usable: Channel[] = channels.filter(isChannelUsable);
  const usableIdx = new Set(usable.map((c) => c.idx));

  const unmapped: UnmappedChannelEntry[] = channels
    .filter((c) => !mappedIdx.has(c.idx))
    .map((c) => ({
      name: c.name,
      freq: c.freq,
      unit: c.unit,
      nSamples: c.nSamples,
      category: c.category,
      status: classifyUnmapped(c),
      min: c.min,
      max: c.max,
      avg: c.avg,
    }));

  let unmappedWithData = 0;
  let unmappedConstant = 0;
  let unmappedEmpty = 0;
  for (const u of unmapped) {
    if (u.status === "data") unmappedWithData++;
    else if (u.status === "constant") unmappedConstant++;
    else unmappedEmpty++;
  }

  // "unmappedChannels" total counts only usable unmapped channels for
  // backwards compatibility with the existing header ratio.
  // "unmappedChannels" total counts only usable unmapped channels for
  // backwards compatibility with the existing header ratio.
  const unmappedUsableCount = unmappedWithData + unmappedConstant; // empty === !usable


  return {
    resolved,
    unresolved,
    unmapped,
    totals: {
      logicalKeys: ALL_LOGICAL_KEYS.length,
      resolvedKeys: resolved.length,
      usableChannels: usable.length,
      mappedChannels: mappedIdx.size,
      unmappedChannels: unmappedUsableCount,
      unmappedWithData,
      unmappedConstant,
      unmappedEmpty,
    },
  };
}

