import { useCallback, useEffect, useRef, useState } from "react";
import type { LdFile, WorkerMessage } from "@/lib/ld/types";
import { parseLdx } from "@/lib/ld/parseLdx";

export interface LoadState {
  loading: boolean;
  progress: number;
  stage: string;
  error: string | null;
  files: LdFile[];
}

export function useLdLoader() {
  const [state, setState] = useState<LoadState>({
    loading: false,
    progress: 0,
    stage: "",
    error: null,
    files: [],
  });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const ensureWorker = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../workers/ldParser.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    return workerRef.current;
  };

  const loadFiles = useCallback(async (fileList: File[]) => {
    setState((s) => ({ ...s, loading: true, error: null, progress: 0, stage: "Lettura file" }));
    const ldFiles = fileList.filter((f) => f.name.toLowerCase().endsWith(".ld"));
    const ldxFiles = fileList.filter((f) => f.name.toLowerCase().endsWith(".ldx"));

    if (ldFiles.length === 0) {
      setState((s) => ({ ...s, loading: false, error: "Nessun file .ld trovato" }));
      return;
    }

    const out: LdFile[] = [];
    try {
      for (let i = 0; i < ldFiles.length; i++) {
        const ld = ldFiles[i];
        const buffer = await ld.arrayBuffer();
        const file = await parseInWorker(ensureWorker(), ld.name, buffer, (pct, stage) =>
          setState((s) => ({
            ...s,
            progress: Math.round(((i + pct / 100) / ldFiles.length) * 100),
            stage: `${ld.name}: ${stage}`,
          })),
        );
        // Match .ldx by base name
        const base = ld.name.replace(/\.ld$/i, "");
        const ldx = ldxFiles.find((x) => x.name.replace(/\.ldx$/i, "") === base);
        if (ldx) {
          try {
            const text = await ldx.text();
            const summary = parseLdx(text);
            file.meta = { ...file.meta, ...summary };
          } catch {
            // ignore
          }
        }
        out.push(file);
      }
      setState({ loading: false, progress: 100, stage: "Pronto", error: null, files: out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({ loading: false, progress: 0, stage: "", error: null, files: [] });
  }, []);

  return { ...state, loadFiles, reset };
}

function parseInWorker(
  worker: Worker,
  fileName: string,
  buffer: ArrayBuffer,
  onProgress: (pct: number, stage: string) => void,
): Promise<LdFile> {
  return new Promise((resolve, reject) => {
    const handler = (ev: MessageEvent<WorkerMessage>) => {
      const m = ev.data;
      if (m.type === "progress") {
        onProgress(m.pct, m.stage);
      } else if (m.type === "result") {
        // Restore Float32Array view (postMessage gives plain object with transferred buffer)
        const file = m.file;
        file.channels = file.channels.map((c) => ({
          ...c,
          values: c.values instanceof Float32Array ? c.values : new Float32Array(c.values as unknown as ArrayBufferLike),
        }));
        worker.removeEventListener("message", handler);
        resolve(file);
      } else if (m.type === "error") {
        worker.removeEventListener("message", handler);
        reject(new Error(m.message));
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ type: "parse", fileName, buffer }, [buffer]);
  });
}
