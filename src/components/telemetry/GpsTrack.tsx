import { useEffect, useRef } from "react";
import type { LdFile } from "@/lib/ld/types";

interface Props {
  file: LdFile;
}

export function GpsTrack({ file }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  const lat = file.channels.find((c) => /gps\s*lat/i.test(c.name));
  const lon = file.channels.find((c) => /gps\s*lon/i.test(c.name));
  const speed =
    file.channels.find((c) => /ground\s*speed/i.test(c.name)) ??
    file.channels.find((c) => /gps\s*speed/i.test(c.name)) ??
    file.channels.find((c) => /drive\s*speed/i.test(c.name));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !lat || !lon || lat.empty || lon.empty) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width = canvas.clientWidth;
    const H = canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const n = Math.min(lat.nSamples, lon.nSamples);
    if (n === 0) return;

    // Find bbox
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = lat.values[i], b = lon.values[i];
      if (a < minLat) minLat = a; if (a > maxLat) maxLat = a;
      if (b < minLon) minLon = b; if (b > maxLon) maxLon = b;
    }
    const padding = 20;
    const dx = maxLon - minLon || 1;
    const dy = maxLat - minLat || 1;
    const scale = Math.min((W - padding * 2) / dx, (H - padding * 2) / dy);

    const toXY = (a: number, b: number) => ({
      x: padding + (b - minLon) * scale,
      y: H - padding - (a - minLat) * scale,
    });

    let sMin = Infinity, sMax = -Infinity;
    if (speed && !speed.empty) {
      for (let i = 0; i < speed.nSamples; i++) {
        const v = speed.values[i];
        if (v < sMin) sMin = v; if (v > sMax) sMax = v;
      }
    }
    const sRange = sMax - sMin || 1;

    const sFreqRatio = speed ? speed.freq / lat.freq : 0;

    ctx.lineWidth = 2;
    for (let i = 1; i < n; i++) {
      const p1 = toXY(lat.values[i - 1], lon.values[i - 1]);
      const p2 = toXY(lat.values[i], lon.values[i]);
      let color = "#3b82f6";
      if (speed && !speed.empty) {
        const sIdx = Math.floor(i * sFreqRatio);
        const sv = speed.values[Math.min(sIdx, speed.nSamples - 1)];
        const t = (sv - sMin) / sRange;
        // Blue -> green -> red
        const hue = 220 - t * 220; // 220 (blue) to 0 (red)
        color = `hsl(${hue}, 80%, 50%)`;
      }
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }, [lat, lon, speed]);

  if (!lat || !lon || lat.empty || lon.empty) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Nessun dato GPS (Latitude/Longitude) in questo file.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-2 text-xs text-muted-foreground">
        Tracciato GPS colorato per velocità{speed ? ` (${speed.name})` : " (velocità non disponibile)"}.
      </div>
      <div className="flex-1 p-4">
        <canvas ref={ref} className="h-full w-full" />
      </div>
    </div>
  );
}
