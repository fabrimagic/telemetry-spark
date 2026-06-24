import { useCallback, useEffect, useRef, useState } from "react";
import type { LdFile, WorkerMessage } from "@/lib/ld/types";
import type { ToolsetFile, ToolsetWorkerMessage } from "@/lib/toolset/types";
import { parseLdx } from "@/lib/ld/parseLdx";

export interface LoadState {
  loading: boolean;
  progress: number;
  stage: string;
  error: string | null;
  files: LdFile[];
  toolsets: ToolsetFile[];
}

export function useLdLoader() {
  const [state, setState] = useState<LoadState>({
    loading: false,
    progress: 0,
    stage: "",
    error: null,
    files: [],
    toolsets: [],
  });
  const ldWorkerRef = useRef<Worker | null>(null);
  const tsWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      ldWorkerRef.current?.terminate();
      tsWorkerRef.current?.terminate();
      ldWorkerRef.current = null;
      tsWorkerRef.current = null;
    };
  }, []);

  const ensureLdWorker = () => {
    if (!ldWorkerRef.current) {
      ldWorkerRef.current = new Worker(
        new URL("../workers/ldParser.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    return ldWorkerRef.current;
  };

  const ensureToolsetWorker = () => {
    if (!tsWorkerRef.current) {
      tsWorkerRef.current = new Worker(
        new URL("../workers/toolsetParser.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    return tsWorkerRef.current;
  };

  const loadFiles = useCallback(async (fileList: File[]) => {
    setState((s) => ({
      ...s,
      loading: true,
      error: null,
      progress: 0,
      stage: "Lettura file",
    }));
    const ldFiles = fileList.filter((f) => f.name.toLowerCase().endsWith(".ld"));
    const ldxFiles = fileList.filter((f) => f.name.toLowerCase().endsWith(".ldx"));
    const toolsetFiles = fileList.filter((f) => f.name.toLowerCase().endsWith(".toolset"));

    if (ldFiles.length === 0 && toolsetFiles.length === 0) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "Nessun file .ld o .toolset trovato",
      }));
      return;
    }

    const totalSteps = ldFiles.length + toolsetFiles.length;
    let completed = 0;

    const outLd: LdFile[] = [];
    const outTs: ToolsetFile[] = [];
    try {
      // .ld files
      for (let i = 0; i < ldFiles.length; i++) {
        const ld = ldFiles[i];
        const buffer = await ld.arrayBuffer();
        const file = await parseLdInWorker(ensureLdWorker(), ld.name, buffer, (pct, stage) =>
          setState((s) => ({
            ...s,
            progress: Math.round(((completed + pct / 100) / totalSteps) * 100),
            stage: `${ld.name}: ${stage}`,
          })),
        );
        const base = ld.name.replace(/\.ld$/i, "");
        const ldx = ldxFiles.find((x) => x.name.replace(/\.ldx$/i, "") === base);
        if (ldx) {
          try {
            const text = await ldx.text();
            const summary = parseLdx(text);
            file.meta = { ...file.meta, ...summary };
          } catch {
            /* ignore */
          }
        }
        outLd.push(file);
        completed++;
      }

      // .toolset files
      for (let i = 0; i < toolsetFiles.length; i++) {
        const ts = toolsetFiles[i];
        const buffer = await ts.arrayBuffer();
        const file = await parseToolsetInWorker(
          ensureToolsetWorker(),
          ts.name,
          buffer,
          (pct, stage) =>
            setState((s) => ({
              ...s,
              progress: Math.round(((completed + pct / 100) / totalSteps) * 100),
              stage: `${ts.name}: ${stage}`,
            })),
        );
        outTs.push(file);
        completed++;
      }

      setState((s) => ({
        loading: false,
        progress: 100,
        stage: "Pronto",
        error: null,
        // Merge with anything already loaded so users can add files incrementally.
        files: [...s.files, ...outLd],
        toolsets: [...s.toolsets, ...outTs],
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      loading: false,
      progress: 0,
      stage: "",
      error: null,
      files: [],
      toolsets: [],
    });
  }, []);

  return { ...state, loadFiles, reset };
}

function parseLdInWorker(
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
        const file = m.file;
        file.channels = file.channels.map((c) => ({
          ...c,
          values:
            c.values instanceof Float32Array
              ? c.values
              : new Float32Array(c.values as unknown as ArrayBufferLike),
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

function parseToolsetInWorker(
  worker: Worker,
  fileName: string,
  buffer: ArrayBuffer,
  onProgress: (pct: number, stage: string) => void,
): Promise<ToolsetFile> {
  return new Promise((resolve, reject) => {
    const handler = (ev: MessageEvent<ToolsetWorkerMessage>) => {
      const m = ev.data;
      if (m.type === "progress") {
        onProgress(m.pct, m.stage);
      } else if (m.type === "result") {
        worker.removeEventListener("message", handler);
        resolve(m.file);
      } else if (m.type === "error") {
        worker.removeEventListener("message", handler);
        reject(new Error(m.message));
      }
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ type: "parse", fileName, buffer }, [buffer]);
  });
}
