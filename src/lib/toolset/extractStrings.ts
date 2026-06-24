// Extract runs of printable ASCII/UTF-8 from a binary blob.
// Sequence rules:
//   - byte in [0x20..0x7E] OR the UTF-8 tail bytes [0x80..0xFF] grouped as continuations,
//     plus tab/space.
//   - terminated by any other control byte.
//   - keep only runs of >= minLen final characters.

export function extractAsciiStrings(bytes: Uint8Array, minLen = 4): string[] {
  const out: string[] = [];
  const len = bytes.length;
  let start = -1;
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    const printable =
      (b >= 0x20 && b <= 0x7e) || b === 0x09 || (b >= 0xc2 && b <= 0xf4) || (b >= 0x80 && b <= 0xbf);
    if (printable) {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start >= minLen) {
        const slice = bytes.subarray(start, i);
        try {
          const s = new TextDecoder("utf-8", { fatal: false }).decode(slice).trim();
          if (s.length >= minLen) out.push(s);
        } catch {
          /* skip */
        }
      }
      start = -1;
    }
  }
  if (start >= 0 && len - start >= minLen) {
    const s = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes.subarray(start, len))
      .trim();
    if (s.length >= minLen) out.push(s);
  }
  return out;
}
