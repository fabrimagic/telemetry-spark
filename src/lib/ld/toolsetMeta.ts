// Small helper to look up toolset-declared alarm ranges for a given LD channel.
// Returns the alarm window only when the toolset marks it as significant
// (i.e. NOT the default 0..1000 placeholder).

import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import { normName } from "@/lib/ld/channelResolver";

export interface ToolsetAlarmRange {
  min: number;
  max: number;
}

export function findAlarmRange(
  toolsetMeta: ToolsetDisplayMeta[] | undefined,
  channelName: string | undefined,
): ToolsetAlarmRange | undefined {
  if (!toolsetMeta || !channelName) return undefined;
  const target = normName(channelName);
  const hit = toolsetMeta.find(
    (m) =>
      normName(m.sourceName) === target &&
      m.hasSignificantAlarmRange &&
      m.alarmMinimum !== undefined &&
      m.alarmMaximum !== undefined,
  );
  if (!hit) return undefined;
  return { min: hit.alarmMinimum!, max: hit.alarmMaximum! };
}
