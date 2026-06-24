import type {
  ToolsetCanBus,
  ToolsetChannelEntry,
  ToolsetContentType,
  ToolsetDisplayMeta,
  ToolsetFile,
  ToolsetIoSensor,
  ToolsetPart,
} from "./types";
import { categorizeToolset } from "./categorize";
import { extractAsciiStrings } from "./extractStrings";
import { extractEntry, isExtractable, methodLabel, readCentralDirectory } from "./zip";

export class ToolsetParseError extends Error {}

interface Options {
  onProgress?: (pct: number, stage: string) => void;
}

const SETUP_BINARY = "setup.binary";
const CONTENT_TYPES = "[Content_Types].xml";

// Strict snake_case identifier: must start lowercase, contain ≥1 underscore segment.
// Tightened (was [A-Za-z]…) to avoid counting CamelCase tokens / XAML fragments.
const SNAKE_NAME_RE = /^[a-z][a-z0-9]*(?:_[a-zA-Z0-9]+)+$/;
const CAN_BUS_RE = /^CAN\s+0*(\d+)(?:\s+([\x20-\x7e]+))?$/i;
const VERSION_RE = /\b(Hardware|Software|Firmware)\s+Version\b/i;
const ALARM_RE = /(error|alarm|timed\s*out|check\s|fault|warning)/i;
// XAML markup tokens that pollute the alarm set when matched as plain strings.
const ALARM_XAML_MARKER_RE = /<dash:|TextBlock|SourceName=|<\w+:|xmlns/i;
const PORT_RE = /^(Input|Digital)\s+\d{1,3}$/;
const DEVICE_HINTS = ["Porsche", "Badenia", "Cosworth", "Pi Research"];

// Expected CAN bus domain labels (Porsche logger). Used as fallback when the
// raw string extracted from setup.binary is missing or corrupted by trailing bytes.
const EXPECTED_CAN_LABELS: Record<number, string> = {
  1: "Antrieb",
  2: "Car",
  3: "Chassis",
  4: "Lights",
  5: "Interior",
  6: "Gearbox",
  7: "Scrutineering",
  8: "Team",
};

// Calibration hint patterns — match raw textual indicators only, never compute factors.
const CALIBRATION_RES: RegExp[] = [
  /\bmV\s*\/\s*G\b/i,
  /\bmV\s*\/\s*DaN\b/i,
  /\bMV\s*per\s*bar\b/i,
  /\bcounts\s+from\b/i,
  /\bGain\s*:/i,
  /\bbar\s*sensor\b/i,
];

/** Truncate a string at the first non-printable-ASCII byte (excluding null). */
function cleanAscii(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) break;
    out += s[i];
  }
  return out.trim();
}


// Default placeholder range for "no real range set". Used to flag significant ranges.
function isPlaceholderRange(min: number | undefined, max: number | undefined): boolean {
  return min === 0 && max === 1000;
}

export async function parseToolset(
  fileName: string,
  buffer: ArrayBuffer,
  opts: Options = {},
): Promise<ToolsetFile> {
  const progress = opts.onProgress ?? (() => {});
  progress(2, "Lettura archivio OPC");

  let entries;
  try {
    entries = readCentralDirectory(buffer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ToolsetParseError(`Il file non è un archivio OPC valido (${msg})`);
  }

  const parts: ToolsetPart[] = entries.map((e) => ({
    name: e.name,
    size: e.uncompressedSize,
    compressedSize: e.compressedSize,
    method: e.method,
    methodLabel: methodLabel(e.method),
    extracted: false,
    reason: isExtractable(e.method)
      ? undefined
      : `compressione ${methodLabel(e.method)} non supportata in-browser`,
  }));

  // --- [Content_Types].xml ---
  progress(10, "Lettura [Content_Types].xml");
  const contentTypes: ToolsetContentType[] = [];
  const ctEntry = entries.find((e) => e.name === CONTENT_TYPES);
  if (ctEntry) {
    try {
      const bytes = await extractEntry(buffer, ctEntry);
      if (bytes) {
        markExtracted(parts, ctEntry.name);
        const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        contentTypes.push(...parseContentTypesXml(xml));
      }
    } catch {
      /* leave empty, proceed */
    }
  }

  // --- setup.binary ---
  progress(25, "Estrazione setup.binary");
  const setupEntry = entries.find((e) => e.name === SETUP_BINARY);
  let strings: string[] = [];
  let setupPresent = false;
  let setupText = "";
  if (setupEntry) {
    setupPresent = true;
    if (!isExtractable(setupEntry.method)) {
      throw new ToolsetParseError(
        `setup.binary presente ma compresso con ${methodLabel(setupEntry.method)}: non leggibile in-browser`,
      );
    }
    const bytes = await extractEntry(buffer, setupEntry);
    if (!bytes) {
      throw new ToolsetParseError("setup.binary non estraibile");
    }
    markExtracted(parts, setupEntry.name);
    // Two views over the same bytes:
    //  - `strings`: extracted printable runs, in order, for token-pattern matches.
    //  - `setupText`: a lossless 1:1 latin-1 decoding for regex matches on
    //    embedded XAML (cross-string content).
    strings = extractAsciiStrings(bytes, 4);
    setupText = decodeLatin1(bytes);
  }

  progress(55, "Analisi stringhe");

  const canBusesMap = new Map<number, string>();
  const channelMap = new Map<string, ToolsetChannelEntry>();
  const alarms = new Set<string>();
  const versions = new Set<string>();
  const calibrationHints = new Set<string>();
  const ioMap = new Map<string, ToolsetIoSensor>();
  let deviceHint: string | undefined;

  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];

    if (!deviceHint) {
      for (const hint of DEVICE_HINTS) {
        if (s.toLowerCase().includes(hint.toLowerCase())) {
          deviceHint = hint;
          break;
        }
      }
    }

    // CAN bus — sanitize tail bytes (string-extractor can pull UTF-8 continuation
    // bytes that survive as "@B", "���" etc.). Keep the longest clean candidate
    // per bus id; final fallback to EXPECTED_CAN_LABELS happens at assembly time.
    const canMatch = s.match(CAN_BUS_RE);
    if (canMatch) {
      const id = parseInt(canMatch[1], 10);
      const label = cleanAscii(canMatch[2] || "");
      const prev = canBusesMap.get(id);
      if (prev === undefined || (label && label.length > prev.length)) {
        canBusesMap.set(id, label);
      }
      continue;
    }

    // Version (length-capped per spec)
    if (VERSION_RE.test(s) && s.length < 60) {
      versions.add(s.trim());
      continue;
    }

    // Calibration hints
    if (s.length <= 120 && CALIBRATION_RES.some((re) => re.test(s))) {
      calibrationHints.add(s.trim());
    }

    // Alarm / diagnostic — exclude XAML markup fragments that match by accident
    // (e.g. "<dash:AlarmDefinition …", "TextBlock", "SourceName=").
    if (ALARM_RE.test(s) && s.length <= 200 && !ALARM_XAML_MARKER_RE.test(s)) {
      alarms.add(s.trim());
      continue;
    }


    // Channel name candidate
    if (SNAKE_NAME_RE.test(s) && s.length <= 80) {
      if (!channelMap.has(s)) {
        const next = strings[i + 1];
        const description = isHumanDescription(next, s) ? next.trim() : undefined;
        channelMap.set(s, {
          name: s,
          description,
          category: categorizeToolset(s),
        });
      }

      // I/O sensor triple: [description][port][snake_name]
      const portToken = strings[i - 1];
      const descToken = strings[i - 2];
      if (
        portToken &&
        PORT_RE.test(portToken) &&
        descToken &&
        isHumanDescription(descToken, s)
      ) {
        if (!ioMap.has(s)) {
          ioMap.set(s, {
            name: s,
            description: descToken.trim(),
            port: portToken.trim(),
            category: categorizeToolset(s),
          });
        }
      }
    }
  }

  // --- XAML <dash:Channel> blocks ---
  progress(80, "Parsing blocchi dash:Channel");
  const { displayMeta, totalBlocks } = setupText
    ? parseDashChannelBlocks(setupText)
    : { displayMeta: [], totalBlocks: 0 };

  // Build CAN bus list — always 8 buses; substitute the expected domain label
  // when the raw extracted string is empty, corrupted, or mismatched.
  const channels = Array.from(channelMap.values());
  const expectedIds = Object.keys(EXPECTED_CAN_LABELS).map((n) => parseInt(n, 10));
  const allIds = new Set<number>([...expectedIds, ...canBusesMap.keys()]);
  const canBuses: ToolsetCanBus[] = Array.from(allIds)
    .sort((a, b) => a - b)
    .map((id) => {
      const raw = canBusesMap.get(id) ?? "";
      const expected = EXPECTED_CAN_LABELS[id];
      const label = raw && (!expected || raw === expected) ? raw : (expected ?? raw);
      return { id, label };
    });


  const notExtracted = buildNotExtractedList(parts, setupPresent);

  progress(100, "Pronto");

  return {
    fileName,
    byteLength: buffer.byteLength,
    parts,
    contentTypes,
    deviceHint,
    canBuses,
    channels: channels.sort((a, b) => a.name.localeCompare(b.name)),
    displayMeta: displayMeta.sort((a, b) => a.sourceName.localeCompare(b.sourceName)),
    dashChannelBlocks: totalBlocks,
    ioSensors: Array.from(ioMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    calibrationHints: Array.from(calibrationHints).sort(),
    alarms: Array.from(alarms).sort(),
    versions: Array.from(versions).sort(),
    notExtracted,
    setupStringCount: strings.length,
    setupBinaryPresent: setupPresent,
  };
}

function markExtracted(parts: ToolsetPart[], name: string) {
  const p = parts.find((x) => x.name === name);
  if (p) {
    p.extracted = true;
    p.reason = undefined;
  }
}

function isHumanDescription(s: string | undefined, owner: string): boolean {
  if (!s) return false;
  if (s.length < 2 || s.length > 120) return false;
  if (s === owner) return false;
  if (SNAKE_NAME_RE.test(s)) return false;
  if (PORT_RE.test(s)) return false;
  const hasLetter = /[A-Za-z]/.test(s);
  if (!hasLetter) return false;
  const hasSpaceOrMixed = /\s/.test(s) || /[A-Z]/.test(s);
  return hasSpaceOrMixed;
}

function decodeLatin1(bytes: Uint8Array): string {
  // 1:1 byte-to-char mapping, lossless for any byte. Avoids replacement chars
  // that would split or corrupt embedded XAML text.
  let out = "";
  const CHUNK = 0x4000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, end)));
  }
  return out;
}

/**
 * Scan setup.binary text for <dash:Channel ... /> or <dash:Channel ... > blocks.
 * Returns last-wins display metadata per unique SourceName and the total block count.
 */
function parseDashChannelBlocks(text: string): {
  displayMeta: ToolsetDisplayMeta[];
  totalBlocks: number;
} {
  const blockRe = /<dash:Channel\b([^>]*?)\/?>/g;
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/g;
  const bySource = new Map<string, ToolsetDisplayMeta>();
  let totalBlocks = 0;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text))) {
    totalBlocks++;
    const attrs: Record<string, string> = {};
    let a: RegExpExecArray | null;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[1]))) {
      attrs[a[1]] = a[2];
    }
    const sourceName = attrs.SourceName;
    if (!sourceName) continue;

    const minimum = numAttr(attrs.Minimum);
    const maximum = numAttr(attrs.Maximum);

    const meta: ToolsetDisplayMeta = {
      sourceName,
      category: categorizeToolset(sourceName),
      quantity: attrs.Quantity || undefined,
      userUnit: attrs.UserUnit || undefined,
      decimalPlaces: numAttr(attrs.DecimalPlaces),
      minimum,
      maximum,
      alarmMinimum: numAttr(attrs.AlarmMinimum),
      alarmMaximum: numAttr(attrs.AlarmMaximum),
      alarmEnabled: attrs.AlarmEnabled ? attrs.AlarmEnabled.toLowerCase() === "true" : undefined,
      hasSignificantRange:
        minimum !== undefined && maximum !== undefined && !isPlaceholderRange(minimum, maximum),
    };
    bySource.set(sourceName, meta); // last wins
  }
  return { displayMeta: Array.from(bySource.values()), totalBlocks };
}

function numAttr(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseContentTypesXml(xml: string): ToolsetContentType[] {
  const out: ToolsetContentType[] = [];
  const defaultRe = /<Default\s+[^>]*Extension="([^"]+)"[^>]*ContentType="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = defaultRe.exec(xml))) {
    out.push({ key: `*.${m[1]}`, contentType: m[2] });
  }
  const overrideRe = /<Override\s+[^>]*PartName="([^"]+)"[^>]*ContentType="([^"]+)"/gi;
  while ((m = overrideRe.exec(xml))) {
    out.push({ key: m[1], contentType: m[2] });
  }
  return out;
}

function buildNotExtractedList(parts: ToolsetPart[], setupPresent: boolean): string[] {
  const out: string[] = [];
  const lzma = parts.filter((p) => p.method === 14);
  if (lzma.length) {
    out.push(
      `Package Metadata/Autocoding compressi in LZMA (${lzma.length}: ${lzma
        .map((p) => p.name)
        .join(", ")}): DLL di UI, non estratti — le librerie ZIP browser standard non decomprimono LZMA.`,
    );
  }
  const otherUnsupported = parts.filter(
    (p) => !p.extracted && p.method !== 14 && !isExtractable(p.method),
  );
  if (otherUnsupported.length) {
    out.push(
      `Compressione non supportata (${otherUnsupported.length}): ${otherUnsupported
        .map((p) => `${p.name} [${p.methodLabel}]`)
        .join(", ")}`,
    );
  }
  if (setupPresent) {
    out.push(
      "Associazione canale → bus CAN: richiede la mappatura binaria, non decodificata.",
    );
    out.push(
      "Mappatura binaria canale → CAN ID → bit offset → scala/offset: non decodificata. Il layout binario proprietario Cosworth in setup.binary non è documentato.",
    );
    out.push(
      "Unità certe disponibili solo per il sottoinsieme di canali con metadati display (blocchi dash:Channel).",
    );

  } else {
    out.push("setup.binary assente: nessuna configurazione estraibile.");
  }
  return out;
}
