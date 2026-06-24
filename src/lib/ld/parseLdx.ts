// Parse the small .ldx XML for session summary (Total Laps, Fastest Lap, Fastest Time).
// MoTeC .ldx encodes summary as: <String Id="Fastest Lap" Value="32"/>
// (attribute-based, not text content). Earlier versions also used text nodes —
// we try the attribute form first, then fall back to a permissive text match.

export interface LdxSummary {
  totalLaps?: number;
  fastestLap?: number;
  fastestTime?: string;
}

function findAttrValue(xml: string, id: string): string | undefined {
  // <String Id="<id>" Value="<value>"/>  (Id and Value may appear in either order)
  const reA = new RegExp(
    `<\\w+\\s+[^>]*Id\\s*=\\s*"${escapeRe(id)}"[^>]*Value\\s*=\\s*"([^"]*)"`,
    "i",
  );
  const reB = new RegExp(
    `<\\w+\\s+[^>]*Value\\s*=\\s*"([^"]*)"[^>]*Id\\s*=\\s*"${escapeRe(id)}"`,
    "i",
  );
  const m = xml.match(reA) ?? xml.match(reB);
  return m ? m[1].trim() : undefined;
}

function findTextContent(xml: string, id: string): string | undefined {
  // <Tag … name="<id>">value</Tag> or <Tag>value</Tag> matched permissively.
  const re = new RegExp(
    `(?:name|Id)\\s*=\\s*"${escapeRe(id)}"[^>]*>\\s*([^<\\s][^<]*)`,
    "i",
  );
  const m = xml.match(re);
  return m ? m[1].trim() : undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseLdx(xmlText: string): LdxSummary {
  const result: LdxSummary = {};
  try {
    const total =
      findAttrValue(xmlText, "Total Laps") ??
      findTextContent(xmlText, "Total Laps");
    const fastestLap =
      findAttrValue(xmlText, "Fastest Lap") ??
      findTextContent(xmlText, "Fastest Lap");
    const fastestTime =
      findAttrValue(xmlText, "Fastest Time") ??
      findTextContent(xmlText, "Fastest Time");

    if (total) {
      const n = parseInt(total, 10);
      if (Number.isFinite(n)) result.totalLaps = n;
    }
    if (fastestLap) {
      const n = parseInt(fastestLap, 10);
      if (Number.isFinite(n)) result.fastestLap = n;
    }
    if (fastestTime) result.fastestTime = fastestTime;
  } catch {
    // .ldx is optional — swallow parse errors
  }
  return result;
}
