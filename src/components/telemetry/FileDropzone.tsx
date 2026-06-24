import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

interface Props {
  loading: boolean;
  progress: number;
  stage: string;
  error: string | null;
  onFiles: (files: File[]) => void;
}

export function FileDropzone({ loading, progress, stage, error, onFiles }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
        dragOver ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <Upload className="mx-auto h-10 w-10 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-semibold">Carica file MoTeC (.ld + .ldx)</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Trascina i file qui o seleziona dal disco. Tutto il parsing avviene nel browser — nessun upload.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          variant="default"
        >
          Scegli file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".ld,.ldx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            e.target.value = "";
          }}
        />
      </div>
      {loading && (
        <div className="mt-6 space-y-2">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground">{stage} — {progress}%</p>
        </div>
      )}
      {error && (
        <p className="mt-4 text-sm text-destructive">⚠ {error}</p>
      )}
    </div>
  );
}
