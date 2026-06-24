// Parse the small .ldx XML for session summary (Total Laps, Fastest Lap, Fastest Time).
// Returns partial SessionMeta fields.

export interface LdxSummary {
  totalLaps?: number;
  fastestLap?: number;
  fastestTime?: string;
}

export function parseLdx(xmlText: string): LdxSummary {
  const result: LdxSummary = {};
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");

    // Multiple firmware variants — search permissively.
    const findText = (re: RegExp) => {
      const m = xmlText.match(re);
      return m ? m[1] : undefined;
    };

    const total = findText(/Total\s*Laps?[^>]*>\s*([0-9]+)/i)
      ?? doc.querySelector("[name='Total Laps']")?.textContent ?? undefined;
    const fastestLap = findText(/Fastest\s*Lap[^>]*>\s*([0-9]+)/i)
      ?? doc.querySelector("[name='Fastest Lap']")?.textContent ?? undefined;
    const fastestTime = findText(/Fastest\s*Time[^>]*>\s*([0-9:.]+)/i)
      ?? doc.querySelector("[name='Fastest Time']")?.textContent ?? undefined;

    if (total) result.totalLaps = parseInt(total, 10);
    if (fastestLap) result.fastestLap = parseInt(fastestLap, 10);
    if (fastestTime) result.fastestTime = fastestTime.trim();
  } catch {
    // ignore — .ldx is optional
  }
  return result;
}
