import { useCallback, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Progress } from "@/components/ui/progress";

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
    <div className="relative">
      {/* chequered ticker */}
      <div className="chequered h-3 w-full" />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer border-x-2 border-b-2 border-ink bg-card p-12 text-center transition-colors ${
          dragOver ? "bg-accent/40" : ""
        }`}
      >
        {/* corner marks */}
        <CornerMark className="left-2 top-2" />
        <CornerMark className="right-2 top-2" />
        <CornerMark className="left-2 bottom-2" />
        <CornerMark className="right-2 bottom-2" />

        <Upload className="mx-auto h-10 w-10 text-race-red" strokeWidth={2.5} />
        <h2 className="mt-6 font-display text-5xl leading-none tracking-wider">
          Drop to <span className="text-race-red">arm</span>
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Trascina <code>.ld</code> · <code>.ldx</code> · <code>.toolset</code> oppure clicca per
          selezionare. Tutto resta nel browser.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ChannelBadge color="red">.LD</ChannelBadge>
          <ChannelBadge color="red">.LDX</ChannelBadge>
          <ChannelBadge color="yellow">.TOOLSET</ChannelBadge>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".ld,.ldx,.toolset"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            e.target.value = "";
          }}
        />

        {loading && (
          <div className="mx-auto mt-8 max-w-md space-y-2">
            <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>{stage}</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5 [&>div]:bg-race-red" />
          </div>
        )}
        {error && (
          <div className="mx-auto mt-6 max-w-md border-l-4 border-race-red bg-race-red/10 px-3 py-2 text-left text-sm">
            <span className="font-mono text-[10px] uppercase tracking-wider text-race-red">
              Red flag
            </span>
            <p className="text-foreground">{error}</p>
          </div>
        )}
      </div>
      <div className="chequered h-3 w-full" />
    </div>
  );
}

function CornerMark({ className }: { className?: string }) {
  return (
    <span
      className={`pointer-events-none absolute h-3 w-3 border-race-red ${className ?? ""}`}
      style={{
        borderTopWidth: className?.includes("top") ? 2 : 0,
        borderBottomWidth: className?.includes("bottom") ? 2 : 0,
        borderLeftWidth: className?.includes("left") ? 2 : 0,
        borderRightWidth: className?.includes("right") ? 2 : 0,
      }}
    />
  );
}

function ChannelBadge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "red" | "yellow";
}) {
  const cls =
    color === "red"
      ? "border-race-red text-race-red"
      : "border-ink bg-hazard text-ink";
  return <span className={`pit-pill ${cls}`}>{children}</span>;
}
