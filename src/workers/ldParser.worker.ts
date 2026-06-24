/// <reference lib="webworker" />
import { parseLd, LdParseError } from "@/lib/ld/parseLd";
import type { WorkerMessage } from "@/lib/ld/types";

interface ParseRequest {
  type: "parse";
  fileName: string;
  buffer: ArrayBuffer;
}

self.addEventListener("message", (ev: MessageEvent<ParseRequest>) => {
  const { type, fileName, buffer } = ev.data;
  if (type !== "parse") return;

  const post = (msg: WorkerMessage, transfer: Transferable[] = []) =>
    (self as unknown as Worker).postMessage(msg, transfer);

  try {
    const parsed = parseLd(buffer, {
      onProgress: (pct, stage) => post({ type: "progress", pct, stage }),
    });
    const file = { fileName, ...parsed };
    // Transfer typed array buffers for zero-copy.
    const transfers: Transferable[] = file.channels
      .map((c) => c.values.buffer)
      .filter((b): b is ArrayBuffer => b.byteLength > 0);
    post({ type: "result", file }, transfers);
  } catch (e) {
    const message = e instanceof LdParseError ? e.message : e instanceof Error ? e.message : String(e);
    post({ type: "error", message });
  }
});

export {};
