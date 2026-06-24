import type {
  ToolsetCanBus,
  ToolsetChannelEntry,
  ToolsetContentType,
  ToolsetFile,
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

const SNAKE_NAME_RE = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+){1,}$/;
const CAN_BUS_RE = /^CAN\s+(\d+)(?:\s+(\S[^\x00]*))?$/i;
const VERSION_RE = /\b(Hardware|Software|Firmware)\s+Version\b[^\x00]*/i;
const ALARM_RE = /(error|alarm|timed\s*out|check\s|fault|warning)/i;
const DEVICE_HINTS = ["Porsche", "Badenia", "Cosworth", "Pi Research"];

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
    reason: isExtractable(e.method) ? undefined : `compressione ${methodLabel(e.method)} non supportata in-browser`,
  }));

  // --- [Content_Types].xml ---
  progress(15, "Lettura [Content_Types].xml");
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
      // leave contentTypes empty; we still proceed
    }
  }

  // --- setup.binary ---
  progress(35, "Estrazione stringhe da setup.binary");
  const setupEntry = entries.find((e) => e.name === SETUP_BINARY);
  let strings: string[] = [];
  let setupPresent = false;
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
    strings = extractAsciiStrings(bytes, 4);
  }

  progress(70, "Analisi stringhe");

  const canBusesMap = new Map<number, string>();
  const channelMap = new Map<string, ToolsetChannelEntry>();
  const alarms = new Set<string>();
  const versions = new Set<string>();
  let deviceHint: string | undefined;

  // First pass: classify each string and build channel descriptions from neighbours.
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];

    // Device hint
    if (!deviceHint) {
      for (const hint of DEVICE_HINTS) {
        if (s.toLowerCase().includes(hint.toLowerCase())) {
          deviceHint = hint;
          break;
        }
      }
    }

    // CAN bus
    const canMatch = s.match(CAN_BUS_RE);
    if (canMatch) {
      const id = parseInt(canMatch[1], 10);
      const label = (canMatch[2] || "").trim();
      const prev = canBusesMap.get(id);
      if (prev === undefined || (label && label.length > prev.length)) {
        canBusesMap.set(id, label);
      }
      continue;
    }

    // Version
    const vMatch = s.match(VERSION_RE);
    if (vMatch) {
      versions.add(s.trim());
      continue;
    }

    // Alarm / diagnostic
    if (ALARM_RE.test(s) && s.length <= 200) {
      alarms.add(s.trim());
      // fall through — alarms can still look like channel names occasionally, but skip
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
    }
  }

  // Build CAN bus list, count channels heuristically associated by label substring.
  const channels = Array.from(channelMap.values());
  const canBuses: ToolsetCanBus[] = Array.from(canBusesMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([id, label]) => ({
      id,
      label,
      channelCount: label
        ? channels.filter((c) =>
            (c.description ?? "").toLowerCase().includes(label.toLowerCase()),
          ).length
        : 0,
    }));

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
  if (s.length < 3 || s.length > 120) return false;
  if (s === owner) return false;
  if (SNAKE_NAME_RE.test(s)) return false; // looks like another channel id
  // must contain at least one letter and one space, or mixed case with a letter
  const hasLetter = /[A-Za-z]/.test(s);
  if (!hasLetter) return false;
  const hasSpaceOrMixed = /\s/.test(s) || /[A-Z]/.test(s);
  return hasSpaceOrMixed;
}

function parseContentTypesXml(xml: string): ToolsetContentType[] {
  const out: ToolsetContentType[] = [];
  // Default elements: <Default Extension="xml" ContentType="…"/>
  const defaultRe = /<Default\s+[^>]*Extension="([^"]+)"[^>]*ContentType="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = defaultRe.exec(xml))) {
    out.push({ key: `*.${m[1]}`, contentType: m[2] });
  }
  // Override elements: <Override PartName="/setup.binary" ContentType="…"/>
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
      `Package LZMA non estratti (${lzma.length}): ${lzma.map((p) => p.name).join(", ")} — le librerie ZIP browser standard non decomprimono LZMA.`,
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
      "Definizioni binarie dei canali in setup.binary (CAN ID numerici, bit offset, scala, offset, soglie): non decodificate — il layout binario proprietario Cosworth non è documentato.",
    );
  } else {
    out.push("setup.binary assente: nessuna stringa di configurazione estraibile.");
  }
  return out;
}
