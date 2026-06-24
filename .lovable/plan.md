# MoTeC Telemetry Analyzer — Build Plan

A fully client-side SPA that parses MoTeC `.ld` (+ optional `.ldx`) files in a Web Worker and visualizes every channel in an interactive dashboard. No backend, no uploads.

## 1. Stack & scaffolding

- Already on TanStack Start + React 19 + Vite + Tailwind v4 + shadcn/ui (keep as-is).
- Add: `recharts` for charts. (Workers + typed arrays are native — no extra deps.)
- Single route `/` (replace placeholder `src/routes/index.tsx`) hosting the whole dashboard.
- All parsing in a dedicated Web Worker — UI thread only renders.

## 2. File layout

```text
src/
  routes/index.tsx                  // dashboard shell
  workers/ldParser.worker.ts        // .ld binary parser (runs off main thread)
  lib/ld/
    types.ts                        // Channel, LdFile, Lap, SessionMeta
    parseLd.ts                      // pure parser used inside the worker
    parseLdx.ts                     // XML metadata parser (main thread, tiny)
    channelOverrides.ts             // special-conversion lookup table
    categorize.ts                   // name-prefix → category
    laps.ts                         // lap segmentation (Lap Number / Lap Distance resets)
    downsample.ts                   // LTTB-style visual decimation
    interpolate.ts                  // resample channels onto Lap Distance axis
  components/telemetry/
    FileDropzone.tsx
    SessionBar.tsx                  // car/track/date/device/#channels/#laps + mode + ref lap
    ChannelSidebar.tsx              // grouped, searchable, checkbox list + badges
    ChartArea.tsx                   // multi-channel chart container, X axis switch
    MultiChannelChart.tsx           // Recharts LineChart, synced cursor, brush
    LapCompareChart.tsx             // one line per lap for a single channel
    ChannelTable.tsx                // min/max/avg/n/freq/unit per channel
    GpsTrack.tsx                    // canvas trace coloured by speed, synced cursor
    CursorContext.tsx               // shared hover x across charts
  hooks/
    useLdLoader.ts                  // wraps worker, exposes progress + result
    useTelemetryStore.ts            // zustand-free: small useReducer/context for selections
```

## 3. Parser (exact spec — no invented offsets)

Header (absolute, LE):
- `0x08 u32` → first channel descriptor ptr
- `0x0C u32` → data block start ptr
- `0x4A char[8]` device, `0x5E char[16]` date, `0x7C char[16]` time
- Car/track strings: try expected offsets; if empty, scan header for printable ASCII tokens and surface what is found, otherwise omit.

Descriptor (relative):
- `+0 u32 prev`, `+4 u32 next`, `+8 u32 data_ptr`, `+12 u32 n_samples`
- `+18 u16 dtype`, `+20 u16 size`, `+22 u16 freq`
- `+24 i16 shift`, `+26 i16 mult`, `+28 i16 scale`, `+30 i16 dec`
- `+32 char[32] name`, `+64 char[12] unit`
- Walk via `next_ptr`; stop on 0 or a ptr already visited (cycle guard).

Raw samples:
- `size==4` → `Int32Array` view; else `Int16Array` view (LE). Never float32.

Conversion (base):
`value = raw * scale / (mult || 1) / 10^dec + shift`, with `scale||1`.

Special overrides (`channelOverrides.ts`) applied AFTER base formula:
- `RPM`, `ecu nmot` → divide by 2.778, badge `conversione speciale`.
- Any channel with `mult==36` in the listed rate set (`sclu *`, `IMU Gyro*`, `sclu FA/RA *`) → keep base value, badge yellow `scala da verificare`. No invented factor.
- `GPS Speed` → badge `scala da verificare`.
- Table is name-keyed and easy to extend.

X axis:
- Per-channel time axis = `i / freq` seconds (do NOT resample to 100 Hz).
- Distance mode: use `Lap Distance` (m) as X; interpolate other channels onto its timeline using each channel's native time axis.

Errors: if header magic / pointers invalid → throw typed `LdParseError`, surfaced as inline toast/banner; never crash.

## 4. .ldx metadata

Small XML parsed on main thread with `DOMParser`: extract `Total Laps`, `Fastest Lap`, `Fastest Time`. Merged into session metadata. Optional — absence is fine.

## 5. Laps

- Multiple `.ld` files → each = one lap/session (named by filename + index).
- Single file with multiple laps → segment by `Lap Number` change, fallback to `Lap Distance` resets (decrease > threshold).
- Lap = `{ index, tStart, tEnd, duration, sampleRange per channel }`.

## 6. Dashboard UX

Top bar (`SessionBar`):
- Vettura, pista, data/ora, device, # canali, # giri.
- Mode toggle: `Giro singolo | Confronto giri | Tutti i giri` (shadcn `ToggleGroup`).
- Reference-lap dropdown showing lap time alongside each entry.

Left sidebar (`ChannelSidebar`):
- Categories from name prefixes per spec (Motore/Freni/Gomme/Sospensioni/Dinamica/GPS/Giro/Elettronica/Ambiente/Altro).
- Search input filters by name.
- Each row: name · unit · freq · badges · checkbox to toggle plot visibility.

Center (`ChartArea`):
- Multi-channel line charts (Recharts). X axis switch: Tempo / Distanza.
- Multiple Y axes when units differ; toggle "Normalizza (0–1)" for shared axis.
- `Confronto giri`: one chart per selected channel, one line per lap.
- `Tutti i giri`: overlay all laps with low opacity, reference lap solid/coloured.
- Synced vertical cursor across charts via `CursorContext` (hover x broadcasts; tooltip on each chart reads values at nearest sample of its own series).
- Brush for zoom/pan + reset-zoom button.
- Visual downsampling above ~2k points per series (LTTB), raw data untouched.

Tabs in the main area: `Grafici | Tabella canali | Mappa GPS`.

`ChannelTable`: min, max, media, n_campioni, freq, unit, badge — every channel.

`GpsTrack`: if `GPS Latitude` + `GPS Longitude` exist, draw polyline on `<canvas>`, colour each segment by `Ground Speed` (or `GPS Speed` with its badge). Subscribes to cursor context to draw the position marker.

## 7. Performance & robustness

- Parser runs in `ldParser.worker.ts`; transfers `ArrayBuffer` to worker, returns transferable typed-array buffers per channel.
- Progress messages (`{type:'progress', pct}`) → progress bar in dropzone.
- Typed arrays throughout (`Int16Array`/`Int32Array` for raw, `Float32Array` for converted).
- LTTB downsampling only at render time.
- No mock data: empty channel → render "Nessun dato" badge; never fabricate values.
- All work stays local — no `fetch`, no analytics.

## 8. Deliverable

Working SPA at `/` that accepts drag-and-drop `.ld` (+ optional `.ldx`), parses correctly on first load of a real file, and exposes every channel via sidebar + charts + table + GPS trace, with the three lap modes and reference-lap selector.

## Open questions (low-impact — happy to default unless you object)

1. Default X axis = **Tempo (s)**, toggle to Distanza when `Lap Distance` exists.
2. Default chart layout = **one chart per Y-unit group** of selected channels (avoids unreadable multi-axis stacks). User can opt into "single chart, multi-axis".
3. Theme = current light shadcn defaults; can switch to dark racing-style later if preferred.
