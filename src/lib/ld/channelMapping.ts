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

export interface UnmappedChannelEntry {
  name: string;
  freq: number;
  unit: string;
  nSamples: number;
  category: ChannelCategory;
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
  };
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

  const usable: Channel[] = channels.filter(isChannelUsable);
  const unmapped: UnmappedChannelEntry[] = usable
    .filter((c) => !mappedIdx.has(c.idx))
    .map((c) => ({
      name: c.name,
      freq: c.freq,
      unit: c.unit,
      nSamples: c.nSamples,
      category: c.category,
    }));

  return {
    resolved,
    unresolved,
    unmapped,
    totals: {
      logicalKeys: ALL_LOGICAL_KEYS.length,
      resolvedKeys: resolved.length,
      usableChannels: usable.length,
      mappedChannels: mappedIdx.size,
      unmappedChannels: unmapped.length,
    },
  };
}
