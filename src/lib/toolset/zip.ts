// Minimal ZIP / OPC central-directory reader.
// Supports listing all entries (any compression method) and extracting bytes
// for STORE (0) and DEFLATE (8) entries via the browser's DecompressionStream.
// LZMA (14) and other methods are listed but not extracted — by design.

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export function methodLabel(method: number): string {
  switch (method) {
    case 0:
      return "store";
    case 8:
      return "deflate";
    case 12:
      return "bzip2";
    case 14:
      return "lzma";
    case 93:
      return "zstd";
    case 95:
      return "xz";
    default:
      return `method-${method}`;
  }
}

export function isExtractable(method: number): boolean {
  return method === 0 || method === 8;
}

function findEocd(view: DataView): number {
  const len = view.byteLength;
  // EOCD is 22 bytes minimum; comment field up to 0xFFFF.
  const min = Math.max(0, len - (0xffff + 22));
  for (let i = len - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

export function readCentralDirectory(buffer: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("Archivio non valido: End-Of-Central-Directory non trovato");

  const totalEntries = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  const entries: ZipEntry[] = [];
  const td = new TextDecoder("utf-8", { fatal: false });
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(p, true) !== CD_SIG) {
      throw new Error(`Central Directory corrotta alla voce ${i + 1}/${totalEntries}`);
    }
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(buffer, p + 46, nameLen);
    const name = td.decode(nameBytes);
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset: localOffset,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Slice the raw (still compressed) data of an entry from the local file header. */
function rawData(buffer: ArrayBuffer, entry: ZipEntry): Uint8Array {
  const view = new DataView(buffer);
  const p = entry.localHeaderOffset;
  if (view.getUint32(p, true) !== LFH_SIG) {
    throw new Error(`Local File Header mancante per ${entry.name}`);
  }
  const nameLen = view.getUint16(p + 26, true);
  const extraLen = view.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  return new Uint8Array(buffer, start, entry.compressedSize);
}

/**
 * Extract bytes of a ZIP entry. Returns null when the compression method is
 * unsupported (LZMA etc.). Never throws for unsupported methods — caller
 * should treat null as "presente, non estratto".
 */
export async function extractEntry(
  buffer: ArrayBuffer,
  entry: ZipEntry,
): Promise<Uint8Array | null> {
  if (entry.method === 0) {
    // STORE — copy slice (already uncompressed). Return a stand-alone buffer.
    return new Uint8Array(rawData(buffer, entry));
  }
  if (entry.method === 8) {
    // DEFLATE raw — supported via Web Streams in modern browsers / workers.
    if (typeof DecompressionStream === "undefined") return null;
    const raw = rawData(buffer, entry);
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([raw]).stream().pipeThrough(ds);
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }
  return null;
}
