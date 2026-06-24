/// <reference lib="webworker" />
import { parseToolset, ToolsetParseError } from "@/lib/toolset/parseToolset";
import type { ToolsetWorkerMessage } from "@/lib/toolset/types";

interface ParseRequest {
  type: "parse";
  fileName: string;
  buffer: ArrayBuffer;
}

self.addEventListener("message", async (ev: MessageEvent<ParseRequest>) => {
  const { type, fileName, buffer } = ev.data;
  if (type !== "parse") return;

  const post = (msg: ToolsetWorkerMessage) =>
    (self as unknown as Worker).postMessage(msg);

  try {
    const file = await parseToolset(fileName, buffer, {
      onProgress: (pct, stage) => post({ type: "progress", pct, stage }),
    });
    post({ type: "result", file });
  } catch (e) {
    const message =
      e instanceof ToolsetParseError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    post({ type: "error", message });
  }
});

export {};
